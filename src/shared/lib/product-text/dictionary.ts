import { foldText } from "./fold";

// Diccionario de abreviaturas y sinónimos del texto de un producto (C-65, design
// D3). Vale para los dos lados: quien busca "desodorante" encuentra "Deo ..." y
// quien busca "deo" encuentra "Desodorante ...". Es dato versionado en el código:
// no hay sinónimos por comercio.

/** Una abreviatura de un grupo y si es seguro reemplazarla en la primera palabra de un nombre guardado. */
export type VocabularyAbbreviation = {
  /** Plegada: sin acentos, sin mayúsculas, sin signos. */
  readonly token: string;
  /**
   * `true` solo si la abreviatura, como primera palabra de un nombre de la base,
   * siempre quiere decir la palabra del grupo. En la búsqueda se expande igual.
   */
  readonly expandFirstWord: boolean;
};

export type VocabularyGroup = {
  /** Palabras completas, la primera es la forma canónica para mostrar (con acentos). */
  readonly words: readonly string[];
  readonly abbreviations: readonly VocabularyAbbreviation[];
};

/** Abreviatura que se puede expandir en la primera palabra de un nombre. */
function safe(token: string): VocabularyAbbreviation {
  return { token, expandFirstWord: true };
}

/** Abreviatura ambigua o que puede ser otra cosa: solo se expande al buscar. */
function searchOnly(token: string): VocabularyAbbreviation {
  return { token, expandFirstWord: false };
}

function group(
  words: readonly string[],
  ...abbreviations: VocabularyAbbreviation[]
): VocabularyGroup {
  return { words, abbreviations };
}

export const VOCABULARY: readonly VocabularyGroup[] = [
  group(["desodorante"], safe("deo"), safe("desod"), searchOnly("des")),
  group(
    ["galletitas", "galletita", "galletas", "galleta"],
    safe("gall"),
    safe("gallet"),
    safe("galle"),
  ),
  group(["chocolate", "chocolates"], safe("choc"), safe("chocol")),
  group(["shampoo", "champú"], safe("sha"), safe("sham"), safe("shamp")),
  group(["acondicionador"], safe("acond"), safe("aco"), safe("acondic")),
  group(["yogur", "yogurt"], safe("yog")),
  group(["jabón"], safe("jab")),
  // "gas" puede ser gas butano; "prot", proteína.
  group(["gaseosa"], searchOnly("gas"), safe("gaseos")),
  group(["bebida"], safe("beb")),
  group(["protector"], searchOnly("prot")),
  group(["líquido", "líquida"], safe("liq")),
  // Ambiguas: la misma abreviatura en dos grupos.
  group(["alfajor", "alfajores"], searchOnly("alf")),
  group(["alfombra"], searchOnly("alf")),
  group(["jugo"], searchOnly("jug")),
  group(["juguete"], searchOnly("jug")),
  group(["coloración"], searchOnly("col")),
  group(["colonia"], searchOnly("col")),
  // Del medio del nombre: solo se expanden al buscar.
  group(["descremado", "descremada"], searchOnly("descrem")),
  group(["parcialmente"], searchOnly("parc")),
  group(["vainilla"], searchOnly("vaini"), searchOnly("vain")),
  group(["polvo"], searchOnly("pvo")),
  group(["negro", "negra"], searchOnly("neg")),
  group(["invisible"], searchOnly("inv")),
  group(["corporal"], searchOnly("corp")),
  group(["campera"], searchOnly("camp")),
  group(["estampado", "estampada"], searchOnly("estamp")),
  group(["remera"], searchOnly("rem")),
  group(["celular"], searchOnly("cel")),
  // De "c/" y "s/": la barra es un separador, queda una letra suelta.
  group(["con"], searchOnly("c")),
  group(["sin"], searchOnly("s")),
  group(["mermelada"], safe("merm")),
  group(["mayonesa"], safe("mayon")),
  group(["cerveza"], safe("cerv")),
  group(["caramelos", "caramelo"], safe("caram")),
  group(["toallitas", "toallas"], searchOnly("toall")),
  group(["detergente"], safe("deterg")),
  // Agregadas con el conteo del SEPA del 2026-11-16 (tarea 1.10); los números están en tasks.md.
  group(["fideos", "fideo"], safe("fid")),
  group(["limpiador", "limpiadores"], searchOnly("limp")),
  group(["alimento", "alimentos"], safe("alim")),
  group(["suavizante"], safe("suav")),
  group(["preservativos", "preservativo"], safe("preserv")),
  group(["sahumerio", "sahumerios"], safe("sahu"), safe("sahum")),
  group(["perfume", "perfumes"], searchOnly("perf")),
  // Ambigua: heladera o helado.
  group(["heladera"], searchOnly("helad")),
  group(["helado", "helados"], searchOnly("helad")),
  group(
    ["aromatizante", "aromatizador"],
    searchOnly("arom"),
    searchOnly("aromat"),
  ),
  group(["lámpara", "lámparas"], searchOnly("lamp")),
  group(["ventilador"], searchOnly("vent")),
  group(["hermético", "hermética"], searchOnly("herm")),
  group(["máquina"], searchOnly("maq")),
  group(["repuesto", "repuestos"], searchOnly("rep")),
  // Del medio del nombre.
  group(["sabor", "sabores"], searchOnly("sab")),
  group(["relleno", "rellena", "rellenas"], searchOnly("rell")),
  group(["blanco", "blanca"], searchOnly("bco")),
  group(["aerosol"], searchOnly("aer")),
  group(["entero", "entera"], searchOnly("ent")),
  group(["surtido", "surtidos", "surtida"], searchOnly("surt")),
  group(["congelado", "congelada"], searchOnly("cong")),
  group(["saquitos", "saquito"], searchOnly("saq")),
  group(["sobres", "sobre"], searchOnly("sob")),
  group(["lata", "latas"], searchOnly("lat")),
  group(["cremoso", "cremosa"], searchOnly("crem")),
];

type FoldedGroup = {
  readonly words: readonly string[];
  readonly tokens: readonly string[];
};

const FOLDED_GROUPS: readonly FoldedGroup[] = VOCABULARY.map((entry) => ({
  words: entry.words.map(foldText),
  tokens: entry.abbreviations.map((abbreviation) => abbreviation.token),
}));

/** Un comienzo de 3 letras o más ya apunta a la palabra ("desod" → desodorante). */
const MIN_PREFIX_LENGTH = 3;

/** Lo que vale como la misma cosa que una palabra buscada. */
export type QueryExpansion = {
  /** Palabras completas: coinciden como parte de una palabra del producto. Incluye la buscada. */
  readonly words: readonly string[];
  /** Abreviaturas: coinciden solo como palabra entera ("gas" no está en "Vegas"). */
  readonly abbreviations: readonly string[];
};

/**
 * Todo lo que vale como `term` (ya plegado): si es igual a una palabra o abreviatura
 * de un grupo, o es el comienzo (3+ letras) de una de sus palabras, todo el grupo.
 * Una palabra fuera del diccionario se expande solo a ella misma.
 */
export function expandQueryTerm(term: string): QueryExpansion {
  const words = new Set<string>([term]);
  const abbreviations = new Set<string>();
  for (const entry of FOLDED_GROUPS) {
    const matches =
      entry.words.includes(term) ||
      entry.tokens.includes(term) ||
      (term.length >= MIN_PREFIX_LENGTH &&
        entry.words.some((word) => word.startsWith(term)));
    if (!matches) continue;
    for (const word of entry.words) words.add(word);
    for (const token of entry.tokens) abbreviations.add(token);
  }
  return { words: [...words], abbreviations: [...abbreviations] };
}

/**
 * La palabra completa (con acentos, minúscula) que reemplaza a `token` cuando es la
 * primera palabra de un nombre guardado, o `null` si no es seguro: no es una
 * abreviatura, es ambigua o puede querer decir otra cosa.
 */
export function firstWordExpansion(token: string): string | null {
  let canonical: string | null = null;
  for (const entry of VOCABULARY) {
    for (const abbreviation of entry.abbreviations) {
      if (abbreviation.token !== token) continue;
      if (!abbreviation.expandFirstWord) return null;
      canonical ??= entry.words[0] ?? null;
    }
  }
  return canonical;
}
