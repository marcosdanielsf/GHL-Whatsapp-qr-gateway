import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../services/api';
import '../styles/app.css';

export function CampaignsView() {
    const { t } = useLanguage();
    const [loading, setLoading] = useState(false);
    const [instances, setInstances] = useState<any[]>([]);
    
    // Form state
    const [name, setName] = useState('');
    const [selectedInstance, setSelectedInstance] = useState('');
    const [message, setMessage] = useState('');
    const [recipients, setRecipients] = useState('');

    useEffect(() => {
        const fetchInstances = async () => {
            try {
                const response = await api.getInstances();
                if (response.success && response.instances) {
                    setInstances(response.instances);
                    if (response.instances.length > 0) {
                        setSelectedInstance(response.instances[0].instanceId);
                    }
                }
            } catch (error) {
                console.error('Error fetching instances:', error);
            }
        };
        fetchInstances();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!selectedInstance || !recipients || !message) {
            toast.error('Please fill all required fields');
            return;
        }

        const numbersList = recipients.split('\n').map(n => n.trim()).filter(n => n.length > 0);
        
        if (numbersList.length === 0) {
            toast.error('No valid recipients found');
            return;
        }

        setLoading(true);
        try {
            // We need to add this endpoint to the api service first, but assuming it exists or using fetch directly
            const response = await fetch(`${import.meta.env.VITE_API_URL}/api/campaigns/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Add auth token if needed, usually handled by interceptor or credentials
                },
                body: JSON.stringify({
                    name,
                    instanceId: selectedInstance,
                    message,
                    numbers: numbersList
                })
            });

            const data = await response.json();

            if (response.ok) {
                toast.success(t('campaignSent'));
                // Reset form
                setName('');
                setMessage('');
                setRecipients('');
            } else {
                toast.error(data.error || 'Error sending campaign');
            }
        } catch (error) {
            console.error('Error creating campaign:', error);
            toast.error('Error sending campaign');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="view-container">
            <header className="view-header">
                <h2>{t('campaigns')}</h2>
            </header>

            <div className="content-card">
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '800px' }}>
                    
                    <div className="form-group">
                        <label>{t('campaignName')}</label>
                        <input 
                            type="text" 
                            className="form-input"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ex: Promo Black Friday"
                        />
                    </div>

                    <div className="form-group">
                        <label>{t('selectInstance')}</label>
                        <select 
                            className="form-select"
                            value={selectedInstance}
                            onChange={(e) => setSelectedInstance(e.target.value)}
                            required
                        >
                            <option value="" disabled>Select...</option>
                            {instances.map(inst => (
                                <option key={inst.instanceId} value={inst.instanceId}>
                                    {inst.instanceName || inst.instanceId}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group">
                        <label>{t('message')}</label>
                        <textarea 
                            className="form-textarea"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            rows={5}
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>{t('recipients')}</label>
                        <textarea 
                            className="form-textarea"
                            value={recipients}
                            onChange={(e) => setRecipients(e.target.value)}
                            rows={8}
                            placeholder={t('recipientsPlaceholder')}
                            required
                            style={{ fontFamily: 'monospace' }}
                        />
                        <small style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', display: 'block' }}>
                            Total: {recipients.split('\n').filter(n => n.trim().length > 0).length}
                        </small>
                    </div>

                    <button 
                        type="submit" 
                        className="btn btn-primary"
                        disabled={loading}
                        style={{ alignSelf: 'flex-start' }}
                    >
                        {loading ? 'Sending...' : t('sendCampaign')}
                    </button>
                </form>
            </div>
        </div>
    );
}
