import '../styles/header.css';
import { Icons } from './icons';

interface HeaderProps {
  isDark: boolean;
  onToggleDark: () => void;
}

export function Header({ isDark, onToggleDark }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="header-content">
        <p className="header-tag">Integración WhatsApp ↔ GHL</p>
        <h1 className="header-title">Panel de Gateway</h1>
      </div>
      <div className="header-actions">
        <div className="header-theme-buttons">
          <button
            className={`theme-btn ${!isDark ? 'active' : ''}`}
            onClick={() => {
              if (isDark) onToggleDark();
            }}
            title="Modo claro"
          >
            <Icons.Sun className="icon" />
            <span>Claro</span>
          </button>
          <button
            className={`theme-btn ${isDark ? 'active' : ''}`}
            onClick={() => {
              if (!isDark) onToggleDark();
            }}
            title="Modo oscuro"
          >
            <Icons.Moon className="icon" />
            <span>Oscuro</span>
          </button>
        </div>
      </div>
    </header>
  );
}
