"use client";

type Cat = { id: string; name: string; slug: string; parent?: string | null };

type Props = {
  categories: Cat[];
  value: string;
  onChange: (slug: string) => void;
  className?: string;
};

/** Root categories only; value is slug or "" for all. */
export default function CategoryFilterSelect({ categories, value, onChange, className }: Props) {
  const roots = categories.filter((c) => !c.parent);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? "input-field text-sm min-w-[200px]"}
      aria-label="Filter by category"
    >
      <option value="">All Categories</option>
      {roots.map((c) => (
        <option key={c.id} value={c.slug}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
