/** Splits "Category — Name" labels (the convention GameDefinition.variantLabels/mapControl.options
 *  use for TF2's maps) into a category -> options structure a two-level picker can use. Options
 *  without a " — " in their label just fall into a single unnamed group, so this degrades safely
 *  for any other game that doesn't use the convention. */
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
