/**
 * Un parámetro de la URL tal como lo entrega Next (`searchParams`): si viene
 * repetido llega como lista y se toma el primero. Sin el parámetro, `undefined`.
 */
export function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
