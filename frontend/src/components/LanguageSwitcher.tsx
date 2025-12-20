
import { useLanguage } from '../context/LanguageContext';
import '../styles/header.css';

const LanguageSwitcher = () => {
    const { language, setLanguage } = useLanguage();

    return (
        <div className="language-buttons" style={{ display: 'flex', gap: '8px', marginRight: '16px' }}>
            <button
                className={`theme-btn ${language === 'es' ? 'active' : ''}`}
                onClick={() => setLanguage('es')}
                title="Español"
            >
                ES
            </button>
            <button
                className={`theme-btn ${language === 'en' ? 'active' : ''}`}
                onClick={() => setLanguage('en')}
                title="English"
            >
                EN
            </button>
            <button
                className={`theme-btn ${language === 'pt' ? 'active' : ''}`}
                onClick={() => setLanguage('pt')}
                title="Português"
            >
                PT
            </button>
        </div>
    );
};

export default LanguageSwitcher;
