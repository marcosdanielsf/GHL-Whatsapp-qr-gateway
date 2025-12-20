import { createContext, useState, useContext, useEffect, type ReactNode } from 'react';
import { translations, type Language } from '../i18n/translations';

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: (key: keyof typeof translations['es']) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
    const [language, setLanguage] = useState<Language>(() => {
        const saved = localStorage.getItem('app-language') as Language;
        if (saved) return saved;
        const browser = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'pt-br';
        if (browser.startsWith('pt')) return 'pt';
        if (browser.startsWith('es')) return 'es';
        return 'pt';
    });

    useEffect(() => {
        localStorage.setItem('app-language', language);
    }, [language]);

    const t = (key: keyof typeof translations['es']) => {
        return translations[language][key] || key;
    };

    return (
        <LanguageContext.Provider value={{ language, setLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};
