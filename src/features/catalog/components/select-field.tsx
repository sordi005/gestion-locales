import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

import { FieldError, fieldInvalidProps } from "./field-error";

type SelectFieldProps = {
  /** Id del control; el mensaje de error es `${id}-error`. */
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** `Select` no admite valores vacíos: cada opción lleva un valor no vacío. */
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly error?: string | undefined;
};

/** Un `Select` con su etiqueta y su mensaje de error, ya conectados para accesibilidad. */
export function SelectField({
  id,
  label,
  value,
  onValueChange,
  options,
  error,
}: SelectFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          id={id}
          className="w-full"
          {...fieldInvalidProps(errorId, error)}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
