/**
 * Universal search: one box for apps, files, copied things and tasks.
 * "aquele PDF do contrato de março" becomes words (contrato), a type (pdf)
 * and a month (3), so it finds the file without its exact name.
 */

export type FileQuery = { terms: string[]; extensions: string[]; month: number | null };

export function fold(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const STOPWORDS = new Set(
  "a o as os um uma uns umas de da do das dos em no na nos nas para pra por com que aquele aquela aquilo esse essa este esta meu minha meus minhas seu sua arquivo arquivos the a an of that this my your file files in on from for with to 的 那个 文件".split(" "),
);

const TYPES: Record<string, string[]> = {
  pdf: ["pdf"],
  pdfs: ["pdf"],
  planilha: ["xlsx", "xls", "csv"],
  planilhas: ["xlsx", "xls", "csv"],
  spreadsheet: ["xlsx", "xls", "csv"],
  excel: ["xlsx", "xls", "csv"],
  documento: ["docx", "doc", "pdf", "txt", "md"],
  doc: ["docx", "doc"],
  word: ["docx", "doc"],
  document: ["docx", "doc", "pdf", "txt", "md"],
  apresentacao: ["pptx", "ppt"],
  slides: ["pptx", "ppt"],
  powerpoint: ["pptx", "ppt"],
  presentation: ["pptx", "ppt"],
  foto: ["jpg", "jpeg", "png", "heic", "webp"],
  fotos: ["jpg", "jpeg", "png", "heic", "webp"],
  imagem: ["jpg", "jpeg", "png", "webp", "gif"],
  print: ["png", "jpg"],
  photo: ["jpg", "jpeg", "png", "heic", "webp"],
  image: ["jpg", "jpeg", "png", "webp", "gif"],
  video: ["mp4", "mov", "mkv", "webm"],
  zip: ["zip", "rar", "7z"],
  instalador: ["exe", "msi"],
  installer: ["exe", "msi"],
  图片: ["jpg", "jpeg", "png"],
  表格: ["xlsx", "xls", "csv"],
};

const MONTHS: Record<string, number> = {
  janeiro: 1, jan: 1, january: 1, fevereiro: 2, fev: 2, february: 2, feb: 2, marco: 3, mar: 3, march: 3, abril: 4, abr: 4, april: 4, apr: 4,
  maio: 5, mai: 5, may: 5, junho: 6, jun: 6, june: 6, julho: 7, jul: 7, july: 7, agosto: 8, ago: 8, august: 8, aug: 8, setembro: 9, set: 9,
  september: 9, sep: 9, outubro: 10, out: 10, october: 10, oct: 10, novembro: 11, nov: 11, november: 11, dezembro: 12, dez: 12, december: 12, dec: 12,
};

export function parseFileQuery(query: string): FileQuery | null {
  const words = fold(query).split(/[\s,.;:!?"'()]+/).filter(Boolean);
  const terms: string[] = [];
  const extensions: string[] = [];
  let month: number | null = null;
  for (const word of words) {
    if (TYPES[word]) extensions.push(...TYPES[word].filter((ext) => !extensions.includes(ext)));
    else if (MONTHS[word] && words.length > 1) month = MONTHS[word];
    else if (/^\.?[a-z0-9]{2,4}$/.test(word) && word.startsWith(".")) extensions.push(word.slice(1));
    else if (!STOPWORDS.has(word) && word.length >= 2) terms.push(word);
  }
  if (terms.length === 0 && extensions.length === 0) return null;
  return { terms: terms.slice(0, 6), extensions, month };
}

/** Every word appears in the text, accents and case ignored. */
export function matchesAll(text: string, query: string) {
  const words = fold(query).split(/\s+/).filter((word) => word.length >= 2 && !STOPWORDS.has(word));
  if (words.length === 0) return false;
  const haystack = fold(text);
  return words.every((word) => haystack.includes(word));
}
