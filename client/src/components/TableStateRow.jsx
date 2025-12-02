import DataState from "../ui/DataState.jsx";

export default function TableStateRow({
  colSpan = 1,
  state = "info",
  tone = "muted",
  title,
  description,
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-4">
        <DataState state={state} tone={tone} title={title} description={description} />
      </td>
    </tr>
  );
}
