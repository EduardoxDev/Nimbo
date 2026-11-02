function codeFromSpeech(spoken) {
  const digits = String(spoken ?? "").replace(/\D/g, "");
  return digits.length > 0 && digits.length <= 6 ? digits.padStart(6, "0") : null;
}

module.exports = { codeFromSpeech };
