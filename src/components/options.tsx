/** <option> list from a readonly array of values. */
export function Options({ values, placeholder }: { values: readonly string[]; placeholder?: string }) {
  return (
    <>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {values.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </>
  );
}
