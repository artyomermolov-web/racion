"use client";

export interface SegmentedOption {
  key: string;
  label: string;
}

interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
}

/** iOS segmented control (тикет 09). Управляемый компонент. */
export function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps) {
  return (
    <div className="seg" role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.key}
          role="tab"
          aria-selected={opt.key === value}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
