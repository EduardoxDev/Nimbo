import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AirVent, Radio, Search } from "lucide-react";
import { useTranslation } from "../i18n";
import { Row, Section } from "../settings/controls";
import { homeApi, type BroadlinkDevice, type IrBrand, type IrStatus } from "./homeStore";

type Busy = "searching" | "connecting" | "catalog" | "downloading" | "testing" | null;

/** Settings > Home: find the Broadlink, then pick the AC model from the SmartIR library. */
export function InfraredSettings() {
  const t = useTranslation();
  const copy = t.prefs.ir;
  const [status, setStatus] = useState<IrStatus | null>(null);
  const [found, setFound] = useState<BroadlinkDevice[] | null>(null);
  const [address, setAddress] = useState("");
  const [brands, setBrands] = useState<IrBrand[] | null>(null);
  const [brand, setBrand] = useState("");
  const [code, setCode] = useState<number | null>(null);
  const [isChoosingModel, setIsChoosingModel] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    homeApi.irStatus().then(setStatus).catch((reason) => setError(String(reason)));
  }, []);

  const needsModel = Boolean(status?.device) && (!status?.model || isChoosingModel);

  useEffect(() => {
    if (!needsModel || brands) return;
    setBusy("catalog");
    homeApi
      .irCatalog()
      .then(setBrands)
      .catch((reason) => setError(String(reason)))
      .finally(() => setBusy(null));
  }, [needsModel, brands]);

  const run = async <T,>(kind: Busy, job: () => Promise<T>) => {
    setBusy(kind);
    setError(null);
    try {
      return await job();
    } catch (reason) {
      setError(String(reason));
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const search = (event?: FormEvent) => {
    event?.preventDefault();
    void run("searching", async () => setFound(await homeApi.irDiscover(address || undefined)));
  };

  const chooseDevice = (device: BroadlinkDevice) =>
    void run("connecting", async () => {
      setStatus(await homeApi.irSelectDevice(device));
      setFound(null);
    });

  const models = useMemo(() => brands?.find((item) => item.brand === brand)?.models ?? [], [brands, brand]);

  const chooseModel = () => {
    const entry = models.find((item) => item.code === code);
    if (!entry) return;
    void run("downloading", async () => {
      setStatus(await homeApi.irSelectModel(entry.code, `${brand} ${entry.models}`));
      setIsChoosingModel(false);
    });
  };

  const test = (service: "turn_on" | "turn_off") =>
    void run("testing", async () => setStatus(await homeApi.irApply(service, null)));

  return (
    <Section title={copy.section}>
      <p className="prefs-card__hint">{copy.hint}</p>

      {!status?.device ? (
        <>
          <div className="prefs-step">{copy.step1}</div>
          <form className="ir-search" onSubmit={search}>
            <input
              value={address}
              placeholder={copy.addressPlaceholder}
              inputMode="decimal"
              spellCheck={false}
              aria-label={copy.searchAddress}
              onChange={(event) => setAddress(event.currentTarget.value)}
            />
            <button className="prefs-button" type="submit" disabled={busy !== null}>
              <Search size={14} strokeWidth={2.4} aria-hidden="true" />
              {busy === "searching" ? copy.searching : address ? copy.searchAddress : copy.search}
            </button>
          </form>
          {found && found.length === 0 && <p className="prefs-card__hint">{copy.noneFound}</p>}
          {found && found.length > 0 && (
            <ul className="prefs-devices">
              {found.map((device) => (
                <li key={device.mac}>
                  <div className="prefs-device prefs-device--static">
                    <span className="prefs-device__icon prefs-device__icon--switch" aria-hidden="true">
                      <Radio size={15} strokeWidth={2.3} />
                    </span>
                    <span className="prefs-device__text">
                      <strong>{device.name}</strong>
                      <span>
                        {device.host} · {device.mac}
                      </span>
                    </span>
                    <button
                      className="prefs-button"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => chooseDevice(device)}
                    >
                      {copy.use}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <Row title={`${copy.device}: ${status.device.name}`} hint={`${status.device.host} · ${status.device.mac}`}>
          <button
            className="prefs-button prefs-button--quiet"
            type="button"
            disabled={busy !== null}
            onClick={() => void run(null, async () => setStatus(await homeApi.irForget()))}
          >
            {copy.forget}
          </button>
        </Row>
      )}

      {status?.device && needsModel && (
        <>
          <div className="prefs-step">{copy.step2}</div>
          {busy === "catalog" || !brands ? (
            <p className="prefs-card__hint">{copy.loadingCatalog}</p>
          ) : (
            <div className="ir-model">
              <label className="prefs-field">
                <span>{copy.brand}</span>
                <select
                  value={brand}
                  onChange={(event) => {
                    setBrand(event.currentTarget.value);
                    setCode(null);
                  }}
                >
                  <option value="">{copy.chooseBrand}</option>
                  {brands.map((item) => (
                    <option key={item.brand} value={item.brand}>
                      {item.brand} ({item.models.length})
                    </option>
                  ))}
                </select>
              </label>
              {models.length > 0 && (
                <div className="ir-model__list" role="radiogroup" aria-label={copy.model}>
                  {models.map((item, index) => (
                    <button
                      key={`${item.code}-${index}`}
                      className={`ir-model__option${code === item.code ? " ir-model__option--active" : ""}`}
                      type="button"
                      role="radio"
                      aria-checked={code === item.code}
                      onClick={() => setCode(item.code)}
                    >
                      <span className="ir-model__code">{item.code}</span>
                      <span>{item.models}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="prefs-form__actions">
                <button className="prefs-button" type="button" disabled={code === null || busy !== null} onClick={chooseModel}>
                  {busy === "downloading" ? copy.downloading : copy.useModel}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {status?.device && status.model && !isChoosingModel && (
        <>
          <Row title={`${copy.modelLabel}: ${status.model.label}`} hint={copy.testHint}>
            <button className="prefs-button prefs-button--quiet" type="button" onClick={() => setIsChoosingModel(true)}>
              {copy.change}
            </button>
          </Row>
          <div className="ir-test">
            <button className="prefs-button" type="button" disabled={busy !== null} onClick={() => test("turn_on")}>
              <AirVent size={14} strokeWidth={2.4} aria-hidden="true" />
              {copy.testOn}
            </button>
            <button className="prefs-button prefs-button--quiet" type="button" disabled={busy !== null} onClick={() => test("turn_off")}>
              {copy.testOff}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="prefs-error" role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}
