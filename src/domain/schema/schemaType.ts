const SCHEMA_TYPE_MAP: Record<string, number> = {
  AngularSchema: 9,
  Module: 3,
  EntitySchema: 0,
  BusinessProcess: 13,
  SourceCodeSchema: 6,
};

export function toSchemaTypeCode(schemaType: string | number): number {
  if (typeof schemaType === 'number') {
    return schemaType;
  }

  const trimmed = schemaType.trim();
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && `${asNumber}` === trimmed) {
    return asNumber;
  }

  const mapped = SCHEMA_TYPE_MAP[trimmed];
  if (mapped === undefined) {
    throw new Error(`Unknown schema type: ${schemaType}`);
  }
  return mapped;
}
