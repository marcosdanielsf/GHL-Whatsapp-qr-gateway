import '../styles/header.css';
import { Icons } from './icons';
import { useLanguage } from '../context/LanguageContext';
import LanguageSwitcher from './LanguageSwitcher';

interface HeaderProps {
  isDark: boolean;
  onToggleDark: () => void;
}

export function Header({ isDark, onToggleDark }: HeaderProps) {
  const { t } = useLanguage();

  return (
    <header className="app-header">
      <div className="header-content">
        <p className="header-tag">{t('appTitle')}</p>
        <h1 className="header-title">{t('gatewayPanel')}</h1>
      </div>
      <div className="header-actions">
        <LanguageSwitcher />
        <div className="header-theme-buttons">
          <button
            className={`theme-btn ${!isDark ? 'active' : ''}`}
            onClick={() => {
              if (isDark) onToggleDark();
            }}
            title={t('lightMode')}
          >
            <Icons.Sun className="icon" />
            <span>{t('lightMode')}</span>
          </button>
          <button
            className={`theme-btn ${isDark ? 'active' : ''}`}
            onClick={() => {
              if (!isDark) onToggleDark();
            }}
            title={t('darkMode')}
          >
            <Icons.Moon className="icon" />
            <span>{t('darkMode')}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
