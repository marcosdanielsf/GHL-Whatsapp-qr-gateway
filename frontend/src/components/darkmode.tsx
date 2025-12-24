interface DarkModeToggleProps {
  isDark: boolean;
  onToggle: () => void;
}

export function DarkModeToggle({ isDark, onToggle }: DarkModeToggleProps) {
  return (
    <button className="btn-outline theme-toggle" onClick={onToggle}>
      {isDark ? 'Modo claro' : 'Modo oscuro'}
    </button>
  );
}

