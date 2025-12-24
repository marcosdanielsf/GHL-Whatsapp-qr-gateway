import { Icons } from './icons';

interface ToastProps {
  type: 'success' | 'error';
  message: string;
}

export function Toast({ type, message }: ToastProps) {
  const Icon = type === 'success' ? Icons.Check : Icons.Error;
  
  return (
    <div className={`toast toast-${type} bounce`}>
      <Icon className="icon-lg" />
      <div>
        <strong>{type === 'success' ? 'Éxito:' : 'Error:'}</strong>{' '}
        <span>{message}</span>
      </div>
    </div>
  );
}