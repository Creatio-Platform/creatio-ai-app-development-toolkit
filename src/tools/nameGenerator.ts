import shortid from 'shortid';

/**
 * Schema name generator utility
 * Generates unique schema names with custom prefix and suffix
 * Based on Creatio's naming pattern: Prefix + CustomName + _ + UniqueID
 */
export class NameGenerator {
  private static initialized = false;

  /**
   * Initialize shortid configuration
   */
  private static initialize(): void {
    if (this.initialized) return;
    
    shortid.characters('0123456789abcdefghijklmnopqrstuvwxyz');
    this.initialized = true;
  }

  /**
   * Generate schema name with optional unique suffix
   * @param customName - User's desired schema name
   * @param prefix - Schema prefix (default: "Usr")
   * @param addUniqueSuffix - Whether to add unique ID suffix (default: false)
   * @param delimiter - Delimiter between name and unique ID (default: "_")
   * @returns Schema name in format: PrefixCustomName or PrefixCustomName_UniqueID
   * @example generate("TestPage", "Usr", false) => "UsrTestPage"
   * @example generate("TestPage", "Usr", true) => "UsrTestPage_c7b273f"
   */
  public static generate(
    customName: string,
    prefix: string = 'Usr',
    addUniqueSuffix: boolean = false,
    delimiter: string = '_',
  ): string {
    // Remove prefix from custom name if it already exists
    const prefixRegExp = new RegExp(`^${prefix}`);
    const nameWithoutPrefix = customName.replace(prefixRegExp, '');

    // Return simple name without suffix if not requested
    if (!addUniqueSuffix) {
      return `${prefix}${nameWithoutPrefix}`;
    }

    // Generate 7-character unique ID
    this.initialize();
    const uniqueId = shortid.generate().slice(0, 7);

    return `${prefix}${nameWithoutPrefix}${delimiter}${uniqueId}`;
  }

  /**
   * Generate unique schema name (backwards compatibility)
   * @deprecated Use generate() with addUniqueSuffix parameter instead
   */
  public static generateUnique(
    customName: string,
    prefix: string = 'Usr',
    delimiter: string = '_',
  ): string {
    return this.generate(customName, prefix, true, delimiter);
  }
}
