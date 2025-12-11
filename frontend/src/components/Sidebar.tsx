import '../styles/sidebar.css';
import { Icons } from './icons';

type View = 'control' | 'instances' | 'webhooks';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const menuItems = [
    {
      id: 'control' as View,
      title: 'Conectar / QR',
      icon: Icons.QrCode,
      description: 'Genera códigos QR y gestiona conexiones',
    },
    {
      id: 'instances' as View,
      title: 'Instancias & Métricas',
      icon: Icons.Users,
      description: 'Consulta instancias activas',
    },
    {
      id: 'webhooks' as View,
      title: 'Webhooks',
      icon: Icons.Webhook,
      description: 'Webhooks OUTBOUND e INBOUND',
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-content">
        <div className="sidebar-section">
          <h3 className="sidebar-title">Menú</h3>
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

