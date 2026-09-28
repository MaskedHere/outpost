/**
 * Splits "Category — Name" labels (used for TF2 maps) into groups for a two-level picker. Labels
 * without a separator go into a single unnamed group.
 */
export interface OptionGroup {
  category: string;
  options: { value: string; label: string }[];
}

export function groupOptions(options: Record<string, string>): OptionGroup[] {
  const order: string[] = [];
  const groups = new Map<string, { value: string; label: string }[]>();

  for (const [value, fullLabel] of Object.entries(options)) {
    const sep = fullLabel.indexOf(' — ');
    const category = sep === -1 ? '' : fullLabel.slice(0, sep);
    const label = sep === -1 ? fullLabel : fullLabel.slice(sep + 3);
    if (!groups.has(category)) {
      groups.set(category, []);
      order.push(category);
    }
    groups.get(category)!.push({ value, label });
  }

  return order.map((category) => ({ category, options: groups.get(category)! }));
}
