export async function confirmDeleteAction({
  confirmDelete,
  title,
  message,
  confirmLabel,
  onDelete,
}) {
  let confirmed = false;
  await confirmDelete({
    title,
    message,
    confirmLabel,
    onConfirm: async () => {
      confirmed = true;
      await onDelete();
    },
  });
  return confirmed;
}
