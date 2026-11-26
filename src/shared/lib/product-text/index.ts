// Texto de un producto: palabras, unidades, diccionario, errores de tipeo, marca y
// nombre presentable (C-65). Módulo puro, sin I/O: lo usan la búsqueda local, la
// sugerencia de la base compartida y el script de carga.
export { BRAND_CASE_EXCEPTIONS, brandCase } from "./brand-case";
export {
  expandQueryTerm,
  firstWordExpansion,
  VOCABULARY,
  type QueryExpansion,
  type VocabularyAbbreviation,
  type VocabularyGroup,
} from "./dictionary";
export { foldText, stripAccents } from "./fold";
export {
  presentableName,
  presentableNameSteps,
  type PresentableNameSteps,
} from "./presentable-name";
export { toSearchTokens } from "./tokens";
export {
  damerauLevenshteinWithin,
  withinTypoDistance,
  withinTypoPrefix,
} from "./typo";
export {
  canonicalUnit,
  MASS_VOLUME_UNITS,
  massVolumeUnit,
  type Quantity,
  quantitiesIn,
  rewriteUnits,
  sameQuantity,
  UNIT_ALIASES,
} from "./units";
