import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@apivator/ui';
import { useT, type MessageKey } from '../i18n';
import { useUi, type Theme } from '../stores/ui';

const order: Theme[] = ['light', 'dark', 'system'];
const labelKeys: Record<Theme, MessageKey<'shell'>> = {
  light: 'theme.light',
  dark: 'theme.dark',
  system: 'theme.system',
};
const icons = { light: Sun, dark: Moon, system: Monitor };

export function ThemeToggle() {
  const t = useT('shell');
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const Icon = icons[theme];
  const label = t(labelKeys[theme]);
  const next = order[(order.indexOf(theme) + 1) % order.length]!;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      title={t('theme.toggleTitle', { label })}
      aria-label={label}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
