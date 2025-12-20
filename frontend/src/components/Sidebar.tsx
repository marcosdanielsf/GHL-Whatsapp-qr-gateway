import '../styles/sidebar.css';
import { Icons } from './icons';
import { useLanguage } from '../context/LanguageContext';

type View = 'control' | 'instances' | 'webhooks' | 'settings' | 'billing' | 'campaigns';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const { t } = useLanguage();

  const menuItems = [
    {
      id: 'control' as View,
      title: t('connect'),
      icon: Icons.QrCode,
      description: t('viewQr'),
    },
    {
      id: 'instances' as View,
      title: t('instances'),
      icon: Icons.Users,
      description: t('instances'),
    },
    {
      id: 'webhooks' as View,
      title: t('webhooks'),
      icon: Icons.Webhook,
      description: t('webhooks'),
    },
    {
      id: 'campaigns' as View,
      title: t('campaigns'),
      icon: Icons.Broadcast,
      description: t('campaigns'),
    },
    {
      id: 'settings' as View,
      title: t('settings'),
      icon: Icons.Settings,
      description: t('settings'),
    },
    {
      id: 'billing' as View,
      title: t('billing'),
      icon: Icons.CreditCard,
      description: t('billing'),
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-content">
        <div className="sidebar-section">
          <h3 className="sidebar-title">{t('menu')}</h3>
          <nav className="sidebar-nav">
            {menuItems.map((item, index) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <div
                  key={item.id}
                  className="sidebar-item-container"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <button
                    className={`sidebar-item ${isActive ? 'active' : ''}`}
                    onClick={() => onViewChange(item.id)}
                    title={item.description}
                  >
                    <div className="sidebar-item-icon-wrapper">
                      <Icon className="sidebar-icon" />
                    </div>
                    <span className="sidebar-text">{item.title}</span>
                    {isActive && <div className="sidebar-item-indicator"></div>}
                  </button>
                </div>
              );
            })}
          </nav>
        </div>
      </div>
    </aside>
  );
}

