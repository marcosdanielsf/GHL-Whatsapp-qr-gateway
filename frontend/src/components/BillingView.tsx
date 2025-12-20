import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { Icons } from './icons';
import { useLanguage } from '../context/LanguageContext';
import { supabase } from '../lib/supabase';

export function BillingView() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<string>('free');

  const fetchSubscription = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userData } = await supabase
        .from('ghl_wa_users')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!userData) return;

      const { data: tenantData, error } = await supabase
        .from('ghl_wa_tenants')
        .select('subscription_status, plan')
        .eq('id', userData.tenant_id)
        .single();

      if (error) throw error;

      if (tenantData) {
        // Map DB plan names to UI plan names
        let plan = tenantData.plan || 'free';
        if (plan === 'starter') plan = 'free';
        if (plan === 'professional') plan = 'pro';
        
        setCurrentPlan(plan);
      }
    } catch (error: any) {
      console.error('Error fetching subscription:', error);
      toast.error(t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const handleSubscribe = async (priceIdKey: string) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ priceId: priceIdKey })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('errorCreatingCheckout'));

      window.location.href = data.url;
    } catch (error: any) {
      toast.error(error.message);
      setLoading(false);
    }
  };

  const handlePortal = async () => {
    setLoading(true);
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        const response = await fetch('/api/stripe/portal', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || t('errorCreatingPortal'));

        window.location.href = data.url;
    } catch (error: any) {
        toast.error(error.message);
        setLoading(false);
    }
  };

  return (
    <div className="content-grid">
      <section className="panel">
        <div className="section-heading">
          <h2>
            <Icons.CreditCard className="icon-lg" />
            {t('billing')}
          </h2>
          <p>{t('manageSubscription')}</p>
        </div>

        <div className="billing-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginTop: '2rem' }}>
            {/* Pro Plan */}
            <div className={`plan-card ${currentPlan === 'pro' ? 'active' : ''}`} style={{ border: '1px solid var(--primary-color)', borderRadius: '8px', padding: '1.5rem', background: 'var(--bg-primary)', position: 'relative' }}>
                {currentPlan === 'pro' && <span className="badge" style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'var(--success-color)', color: '#fff', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>{t('active')}</span>}
                <h3>{t('proPlan')}</h3>
                <p className="price" style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '1rem 0' }}>$49/mo</p>
                <div style={{ marginBottom: '1rem', color: 'var(--success-color)', fontWeight: 'bold', fontSize: '0.9rem' }}>
                    {t('trialLabel')}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, marginBottom: '2rem' }}>
                    <li style={{ marginBottom: '0.5rem' }}>✓ {t('upTo3Instances')}</li>
                    <li style={{ marginBottom: '0.5rem' }}>✓ {t('prioritySupport')}</li>
                </ul>
                {currentPlan === 'pro' ? (
                    <button className="btn btn-secondary" onClick={handlePortal} disabled={loading}>{t('manageSubscription')}</button>
                ) : (
                    <button className="btn btn-primary" onClick={() => handleSubscribe('pro')} disabled={loading}>{t('startTrial')}</button>
                )}
            </div>

            {/* Enterprise Plan */}
            <div className={`plan-card ${currentPlan === 'enterprise' ? 'active' : ''}`} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1.5rem', background: 'var(--bg-secondary)', position: 'relative' }}>
                {currentPlan === 'enterprise' && <span className="badge" style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'var(--success-color)', color: '#fff', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>{t('active')}</span>}
                <h3>{t('enterprisePlan')}</h3>
                <p className="price" style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '1rem 0' }}>$99/mo</p>
                <div style={{ marginBottom: '1rem', color: 'var(--success-color)', fontWeight: 'bold', fontSize: '0.9rem' }}>
                    {t('trialLabel')}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, marginBottom: '2rem' }}>
                    <li style={{ marginBottom: '0.5rem' }}>✓ {t('unlimitedInstances')}</li>
                    <li style={{ marginBottom: '0.5rem' }}>✓ {t('prioritySupport')}</li>
                </ul>
                {currentPlan === 'enterprise' ? (
                    <button className="btn btn-secondary" onClick={handlePortal} disabled={loading}>{t('manageSubscription')}</button>
                ) : (
                    <button className="btn btn-primary" onClick={() => handleSubscribe('enterprise')} disabled={loading}>{t('startTrial')}</button>
                )}
            </div>
        </div>
      </section>
    </div>
  );
}
