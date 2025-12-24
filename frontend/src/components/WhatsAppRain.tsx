// WhatsAppRain.tsx
import { useMemo } from 'react';
import '../styles/WhatsAppRainCSS.css';

const DROP_COUNT = 42;

export function WhatsAppRain() {
  const drops = useMemo(
    () =>
      Array.from({ length: DROP_COUNT }).map((_, i) => {
        const baseDuration = 12 + Math.random() * 8;
        const swayAmount = 20 + Math.random() * 30;
        const rotationSpeed = 0.5 + Math.random() * 0.5;
        const sizeVariation = 20 + Math.random() * 12;
        
        return {
          left: Math.random() * 100,
          duration: baseDuration,
          delay: Math.random() * 10,
          size: sizeVariation,
          sway: swayAmount,
          rotation: rotationSpeed,
          animationType: i % 3 === 0 ? 'sway' : i % 3 === 1 ? 'spiral' : 'straight',
        };
      }),
    []
  );

  return (
    <div className="whatsapp-rain">
      {drops.map((drop, i) => (
        <i
          key={i}
          className={`fi fi-brands-whatsapp whatsapp-drop whatsapp-drop-${drop.animationType}`}
          style={{
            left: `${drop.left}%`,
            animationDuration: `${drop.duration}s`,
            animationDelay: `${drop.delay}s`,
            fontSize: `${drop.size}px`,
            '--sway-amount': `${drop.sway}px`,
            '--rotation-speed': `${drop.rotation}`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
