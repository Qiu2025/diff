import './ThemeToggle.css';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeToggleProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

export function ThemeToggle({ theme, onThemeChange }: ThemeToggleProps) {
  return (
    <label className="theme-toggle">
      <span className="theme-toggle-label">Theme</span>
      <select
        value={theme}
        onChange={(event) => onThemeChange(event.target.value as Theme)}
        aria-label="Color theme"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
