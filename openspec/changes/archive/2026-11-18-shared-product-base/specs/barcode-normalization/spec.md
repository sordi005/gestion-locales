## ADDED Requirements

### Requirement: Elegibilidad para la base compartida (espejo de la base)
`src/shared/lib/barcode.ts` SHALL exportar `sharedBaseEligibility(norm: BarcodeNorm): "eligible" | "unsupported_length" | "invalid_check_digit" | "restricted_internal" | "variable_measure" | "restricted_other"`, con exactamente las mismas reglas y el mismo orden que `private.shared_barcode_eligibility` (capacidad `shared-product-base`). El test MUST usar la misma tabla de casos que el pgTAP, copiada literal. Este resultado aplica **solo** a la base compartida (nivel 2): en el catálogo de cada comercio (nivel 1) el dígito verificador inválido sigue siendo la advertencia del requisito "Dígito verificador GTIN" y nunca un rechazo.

#### Scenario: Mismo resultado que la base
- **WHEN** se evalúa cada código de la tabla de casos en TypeScript y en SQL
- **THEN** los dos dan el mismo resultado para todos

#### Scenario: UPC-A y su EAN-13
- **WHEN** se evalúa un UPC-A elegible y su EAN-13 con `0` inicial
- **THEN** los dos dan `eligible`

#### Scenario: GTIN-8 relleno en 12 o 13 dígitos
- **WHEN** se evalúa un GTIN-8 relleno con ceros hasta 12 o 13 dígitos (por ejemplo `000001234565`, `0000001234565` o `000077901231`)
- **THEN** se evalúa con las reglas del EAN-8 de sus últimos 8 dígitos: el mismo código da el mismo resultado en 8, 12 y 13 dígitos

#### Scenario: Nivel 1 no cambia
- **WHEN** se normaliza para el catálogo del comercio un EAN-13 con dígito inválido
- **THEN** `normalizeBarcode` sigue devolviendo `ok` con la advertencia `invalid_check_digit`, aunque `sharedBaseEligibility` lo rechace
