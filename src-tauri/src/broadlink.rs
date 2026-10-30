//! Local-network client for Broadlink IR blasters (RM4 Mini and relatives).
//!
//! Talks the device's own UDP protocol directly (the same one python-broadlink
//! implements): discovery broadcast, an AES-128-CBC authenticated session, then
//! "send" and "learn" commands. Nothing goes through Broadlink's cloud.

use aes::cipher::{block_padding::NoPadding, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use serde::{Deserialize, Serialize};
use std::{
    net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;
type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

const DEFAULT_KEY: [u8; 16] = [
    0x09, 0x76, 0x28, 0x34, 0x3f, 0xe9, 0x9e, 0x23, 0x76, 0x5c, 0x15, 0x13, 0xac, 0xcf, 0x8b, 0x02,
];
const IV: [u8; 16] = [
    0x56, 0x2e, 0x17, 0x99, 0x6d, 0x09, 0x3d, 0x28, 0xdd, 0xb3, 0xba, 0x69, 0x5a, 0x2e, 0x6f, 0x58,
];
const MAGIC: [u8; 8] = [0x5a, 0xa5, 0xaa, 0x55, 0x5a, 0xa5, 0xaa, 0x55];
const DEVICE_PORT: u16 = 80;
const COMMAND_AUTH: u16 = 0x65;
const COMMAND_REMOTE: u16 = 0x6a;
const REMOTE_SEND: u32 = 0x02;
const REMOTE_LEARN: u32 = 0x03;
const REMOTE_CHECK: u32 = 0x04;
const REPLY_TIMEOUT: Duration = Duration::from_secs(4);
/// IR codes larger than this are not real remotes; refuse them early.
const MAX_CODE_BYTES: usize = 4_096;

/// A Broadlink found on the network, as shown in settings and saved to disk.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BroadlinkDevice {
    pub host: String,
    /// MAC as it appears on the device label, e.g. "e8:16:56:aa:bb:cc".
    pub mac: String,
    pub devtype: u16,
    pub name: String,
}

/// An authenticated conversation with one device.
pub(crate) struct Session {
    address: SocketAddr,
    /// MAC bytes in the order the device sends them (reversed from the label).
    raw_mac: [u8; 6],
    devtype: u16,
    id: u32,
    key: [u8; 16],
    count: u16,
}

fn checksum(bytes: &[u8]) -> u16 {
    bytes
        .iter()
        .fold(0xbeaf_u32, |sum, byte| sum.wrapping_add(u32::from(*byte)))
        as u16
}

fn encrypt(key: &[u8; 16], payload: &[u8]) -> Vec<u8> {
    let mut buffer = payload.to_vec();
    buffer.resize(payload.len().div_ceil(16) * 16, 0);
    let length = buffer.len();
    Aes128CbcEnc::new(key.into(), &IV.into())
        .encrypt_padded_mut::<NoPadding>(&mut buffer, length)
        .expect("buffer is block aligned")
        .to_vec()
}

fn decrypt(key: &[u8; 16], payload: &[u8]) -> Result<Vec<u8>, String> {
    if !payload.len().is_multiple_of(16) {
        return Err("The Broadlink sent a damaged answer.".to_string());
    }
    let mut buffer = payload.to_vec();
    Aes128CbcDec::new(key.into(), &IV.into())
        .decrypt_padded_mut::<NoPadding>(&mut buffer)
        .map(<[u8]>::to_vec)
        .map_err(|_| "The Broadlink sent a damaged answer.".to_string())
}

/// RM4-era devices (and the RM mini 3 "B" model) wrap remote commands with a
/// length prefix; the first-generation RM devices (0x27xx) do not.
fn uses_length_prefix(devtype: u16) -> bool {
    devtype >= 0x5000
}

fn format_mac(raw: &[u8; 6]) -> String {
    raw.iter()
        .rev()
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn parse_mac(text: &str) -> Result<[u8; 6], String> {
    let bytes: Vec<u8> = text
        .split(':')
        .map(|part| u8::from_str_radix(part, 16))
        .collect::<Result<_, _>>()
        .map_err(|_| "Invalid Broadlink MAC address.".to_string())?;
    let mut raw: [u8; 6] = bytes
        .try_into()
        .map_err(|_| "Invalid Broadlink MAC address.".to_string())?;
    raw.reverse();
    Ok(raw)
}

/// The machine's address on the LAN, which the discovery packet must carry.
fn local_ipv4() -> Ipv4Addr {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            socket.connect("192.0.2.1:9")?;
            socket.local_addr()
        })
        .ok()
        .and_then(|address| match address {
            SocketAddr::V4(v4) => Some(*v4.ip()),
            SocketAddr::V6(_) => None,
        })
        .unwrap_or(Ipv4Addr::UNSPECIFIED)
}

fn discovery_packet(local_ip: Ipv4Addr, port: u16) -> [u8; 0x30] {
    let mut packet = [0_u8; 0x30];
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    // The device only needs a plausible clock; UTC fields are enough.
    let days = seconds / 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    packet[0x0c..0x0e].copy_from_slice(&(year as u16).to_le_bytes());
    packet[0x0e] = ((seconds / 60) % 60) as u8;
    packet[0x0f] = ((seconds / 3_600) % 24) as u8;
    packet[0x10] = (year % 100) as u8;
    packet[0x11] = (((days + 3) % 7) + 1) as u8;
    packet[0x12] = day as u8;
    packet[0x13] = month as u8;
    let mut ip = local_ip.octets();
    ip.reverse();
    packet[0x18..0x1c].copy_from_slice(&ip);
    packet[0x1c..0x1e].copy_from_slice(&port.to_le_bytes());
    packet[0x26] = 6;
    let sum = checksum(&packet);
    packet[0x20..0x22].copy_from_slice(&sum.to_le_bytes());
    packet
}

/// Gregorian date from days since 1970-01-01 (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn parse_discovery_reply(reply: &[u8], from: SocketAddr) -> Option<BroadlinkDevice> {
    if reply.len() < 0x40 {
        return None;
    }
    let devtype = u16::from_le_bytes([reply[0x34], reply[0x35]]);
    let raw_mac: [u8; 6] = reply[0x3a..0x40].try_into().ok()?;
    let name = reply[0x40..]
        .split(|byte| *byte == 0)
        .next()
        .map(|bytes| String::from_utf8_lossy(bytes).trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Broadlink".to_string());
    Some(BroadlinkDevice {
        host: from.ip().to_string(),
        mac: format_mac(&raw_mac),
        devtype,
        name,
    })
}

/// Broadcasts a discovery packet (or sends it to `target`) and collects replies.
pub(crate) fn discover(target: Option<Ipv4Addr>, wait: Duration) -> Result<Vec<BroadlinkDevice>, String> {
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|error| format!("Could not open the network: {error}"))?;
    socket.set_broadcast(true).map_err(|error| error.to_string())?;
    let port = socket.local_addr().map_err(|error| error.to_string())?.port();
    let packet = discovery_packet(local_ipv4(), port);
    let destination = target.unwrap_or(Ipv4Addr::BROADCAST);
    socket
        .send_to(&packet, SocketAddrV4::new(destination, DEVICE_PORT))
        .map_err(|error| format!("Could not search the network: {error}"))?;

    let deadline = Instant::now() + wait;
    let mut devices: Vec<BroadlinkDevice> = Vec::new();
    let mut buffer = [0_u8; 1024];
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        socket
            .set_read_timeout(Some(left.max(Duration::from_millis(1))))
            .map_err(|error| error.to_string())?;
        match socket.recv_from(&mut buffer) {
            Ok((size, from)) => {
                if let Some(device) = parse_discovery_reply(&buffer[..size], from) {
                    if !devices.iter().any(|known| known.mac == device.mac) {
                        devices.push(device);
                    }
                }
            }
            Err(error)
                if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) =>
            {
                break
            }
            Err(error) => return Err(format!("Network error while searching: {error}")),
        }
    }
    Ok(devices)
}

impl Session {
    /// Opens a session: the device answers the auth request with a per-session key.
    pub(crate) fn connect(device: &BroadlinkDevice) -> Result<Self, String> {
        let host: Ipv4Addr = device
            .host
            .parse()
            .map_err(|_| "The Broadlink address is not valid.".to_string())?;
        let mut session = Session {
            address: SocketAddr::V4(SocketAddrV4::new(host, DEVICE_PORT)),
            raw_mac: parse_mac(&device.mac)?,
            devtype: device.devtype,
            id: 0,
            key: DEFAULT_KEY,
            count: rand_count(),
        };
        let mut payload = [0_u8; 0x50];
        payload[0x04..0x14].fill(0x31);
        payload[0x1e] = 0x01;
        payload[0x2d] = 0x01;
        payload[0x30..0x36].copy_from_slice(b"Test 1");
        let reply = session.exchange(COMMAND_AUTH, &payload)?;
        if reply.len() < 0x14 {
            return Err("The Broadlink refused to pair. Unlock it in the Broadlink app.".to_string());
        }
        session.id = u32::from_le_bytes([reply[0], reply[1], reply[2], reply[3]]);
        session.key.copy_from_slice(&reply[0x04..0x14]);
        Ok(session)
    }

    pub(crate) fn send_code(&mut self, code: &[u8]) -> Result<(), String> {
        if code.is_empty() || code.len() > MAX_CODE_BYTES {
            return Err("This IR code is not valid.".to_string());
        }
        self.remote(REMOTE_SEND, code).map(|_| ())
    }

    /// Puts the device in learning mode and waits for a remote button press.
    pub(crate) fn learn(&mut self, wait: Duration) -> Result<Vec<u8>, String> {
        self.remote(REMOTE_LEARN, &[])?;
        let deadline = Instant::now() + wait;
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(600));
            // The device answers with an error code until it has caught a signal.
            if let Ok(code) = self.remote(REMOTE_CHECK, &[]) {
                if !code.is_empty() {
                    return Ok(code);
                }
            }
        }
        Err("No remote signal arrived. Point the remote at the Broadlink and press the button.".to_string())
    }

    fn remote(&mut self, command: u32, data: &[u8]) -> Result<Vec<u8>, String> {
        let mut packet = Vec::with_capacity(data.len() + 6);
        if uses_length_prefix(self.devtype) {
            packet.extend_from_slice(&((data.len() + 4) as u16).to_le_bytes());
        }
        packet.extend_from_slice(&command.to_le_bytes());
        packet.extend_from_slice(data);
        let reply = self.exchange(COMMAND_REMOTE, &packet)?;
        if uses_length_prefix(self.devtype) {
            if reply.len() < 6 {
                return Ok(Vec::new());
            }
            let length = usize::from(u16::from_le_bytes([reply[0], reply[1]]));
            let end = (length + 2).min(reply.len());
            Ok(reply.get(6..end).map(<[u8]>::to_vec).unwrap_or_default())
        } else {
            Ok(reply.get(4..).map(<[u8]>::to_vec).unwrap_or_default())
        }
    }

    fn exchange(&mut self, command: u16, payload: &[u8]) -> Result<Vec<u8>, String> {
        self.count = (self.count.wrapping_add(1)) | 0x8000;
        let packet = build_packet(self, command, payload);

        let socket = UdpSocket::bind("0.0.0.0:0").map_err(|error| format!("Could not open the network: {error}"))?;
        socket.set_read_timeout(Some(REPLY_TIMEOUT)).map_err(|error| error.to_string())?;
        let mut buffer = [0_u8; 2048];
        for _attempt in 0..2 {
            socket
                .send_to(&packet, self.address)
                .map_err(|error| format!("Could not reach the Broadlink: {error}"))?;
            match socket.recv_from(&mut buffer) {
                Ok((size, _)) => return parse_reply(&self.key, &buffer[..size]),
                Err(error)
                    if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) =>
                {
                    continue
                }
                Err(error) => return Err(format!("Network error talking to the Broadlink: {error}")),
            }
        }
        Err("The Broadlink did not answer. Check that it is on the same Wi-Fi.".to_string())
    }
}

fn build_packet(session: &Session, command: u16, payload: &[u8]) -> Vec<u8> {
    let mut packet = vec![0_u8; 0x38];
    packet[0x00..0x08].copy_from_slice(&MAGIC);
    packet[0x24..0x26].copy_from_slice(&session.devtype.to_le_bytes());
    packet[0x26..0x28].copy_from_slice(&command.to_le_bytes());
    packet[0x28..0x2a].copy_from_slice(&session.count.to_le_bytes());
    packet[0x2a..0x30].copy_from_slice(&session.raw_mac);
    packet[0x30..0x34].copy_from_slice(&session.id.to_le_bytes());
    packet[0x34..0x36].copy_from_slice(&checksum(payload).to_le_bytes());
    packet.extend_from_slice(&encrypt(&session.key, payload));
    let sum = checksum(&packet);
    packet[0x20..0x22].copy_from_slice(&sum.to_le_bytes());
    packet
}

fn parse_reply(key: &[u8; 16], reply: &[u8]) -> Result<Vec<u8>, String> {
    if reply.len() < 0x38 {
        return Err("The Broadlink sent a damaged answer.".to_string());
    }
    let error = u16::from_le_bytes([reply[0x22], reply[0x23]]);
    if error != 0 {
        return Err(format!("The Broadlink answered with error {error:#06x}."));
    }
    decrypt(key, &reply[0x38..])
}

fn rand_count() -> u16 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos() as u16)
        .unwrap_or(0x1234)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Session {
        Session {
            address: "192.168.0.50:80".parse().unwrap(),
            raw_mac: parse_mac("e8:16:56:aa:bb:cc").unwrap(),
            devtype: 0x6539,
            id: 0x0102_0304,
            key: DEFAULT_KEY,
            count: 0x8001,
        }
    }

    #[test]
    fn checksum_starts_at_beaf_and_wraps() {
        assert_eq!(checksum(&[]), 0xbeaf);
        assert_eq!(checksum(&[1, 2, 3]), 0xbeb5);
        assert_eq!(checksum(&[0xff; 0x200]), (0xbeaf_u32 + 0xff * 0x200) as u16);
    }

    #[test]
    fn encryption_round_trips_and_pads_to_blocks() {
        let encrypted = encrypt(&DEFAULT_KEY, b"hello broadlink");
        assert_eq!(encrypted.len(), 16);
        let decrypted = decrypt(&DEFAULT_KEY, &encrypted).unwrap();
        assert_eq!(&decrypted[..15], b"hello broadlink");
        assert!(decrypt(&DEFAULT_KEY, &[1, 2, 3]).is_err());
    }

    #[test]
    fn packets_carry_header_fields_and_valid_checksums() {
        let session = session();
        let payload = [7_u8; 20];
        let packet = build_packet(&session, COMMAND_REMOTE, &payload);
        assert_eq!(&packet[..8], &MAGIC);
        assert_eq!(packet.len(), 0x38 + 32);
        assert_eq!(u16::from_le_bytes([packet[0x24], packet[0x25]]), 0x6539);
        assert_eq!(u16::from_le_bytes([packet[0x26], packet[0x27]]), COMMAND_REMOTE);
        assert_eq!(&packet[0x2a..0x30], &[0xcc, 0xbb, 0xaa, 0x56, 0x16, 0xe8]);
        assert_eq!(u16::from_le_bytes([packet[0x34], packet[0x35]]), checksum(&payload));
        let mut zeroed = packet.clone();
        zeroed[0x20] = 0;
        zeroed[0x21] = 0;
        assert_eq!(u16::from_le_bytes([packet[0x20], packet[0x21]]), checksum(&zeroed));
    }

    #[test]
    fn discovery_replies_give_host_mac_type_and_name() {
        let mut reply = vec![0_u8; 0x80];
        reply[0x34..0x36].copy_from_slice(&0x6539_u16.to_le_bytes());
        reply[0x3a..0x40].copy_from_slice(&[0xcc, 0xbb, 0xaa, 0x56, 0x16, 0xe8]);
        reply[0x40..0x4b].copy_from_slice(b"Sala RM4 Mi");
        let device = parse_discovery_reply(&reply, "192.168.0.50:80".parse().unwrap()).unwrap();
        assert_eq!(device.host, "192.168.0.50");
        assert_eq!(device.mac, "e8:16:56:aa:bb:cc");
        assert_eq!(device.devtype, 0x6539);
        assert_eq!(device.name, "Sala RM4 Mi");
        assert!(parse_discovery_reply(&reply[..0x20], "1.2.3.4:80".parse().unwrap()).is_none());
    }

    #[test]
    fn discovery_packet_is_checksummed_and_dates_are_sane() {
        let packet = discovery_packet(Ipv4Addr::new(192, 168, 0, 10), 40_000);
        assert_eq!(&packet[0x18..0x1c], &[10, 0, 168, 192]);
        assert_eq!(u16::from_le_bytes([packet[0x1c], packet[0x1d]]), 40_000);
        let mut zeroed = packet;
        zeroed[0x20] = 0;
        zeroed[0x21] = 0;
        assert_eq!(u16::from_le_bytes([packet[0x20], packet[0x21]]), checksum(&zeroed));
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_756), (2026, 10, 30));
    }

    #[test]
    fn rm4_devices_use_the_length_prefix() {
        assert!(uses_length_prefix(0x6539));
        assert!(uses_length_prefix(0x5f36));
        assert!(!uses_length_prefix(0x2737));
    }
}
