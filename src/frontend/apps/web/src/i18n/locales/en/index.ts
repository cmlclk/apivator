/** Bu dilin açılışta yüklenen ad alanları, tek parça olarak (`tools*` hariç; araçlar açılınca yüklenir). */
const modules = import.meta.glob<Record<string, unknown>>(['./*.json', '!./tools*.json'], {
  eager: true,
  import: 'default',
});

export default Object.fromEntries(
  Object.entries(modules).map(([path, messages]) => [path.slice(2, -5), messages]),
);
