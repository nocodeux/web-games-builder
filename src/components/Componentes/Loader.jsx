import React from 'react';

const getThemeColor = (val, themeVar) => {
  if (!val || val.toLowerCase() === '#00ff00' || val.toLowerCase() === '#000000' || val === 'transparent') return `var(${themeVar})`;
  return val;
};

function Loader({ 
  loaderType = 'spinner', 
  color = '', 
  size = 40, 
  speed = 1,
  thickness = 4,
  width = 'auto',
  height = 'auto'
}) {
  const finalColor = getThemeColor(color, '--accent');
  const duration = (2 / speed).toFixed(2);

  const renderLoader = () => {
    switch (loaderType) {
      case 'dots':
        return (
          <div className="retro-loader-dots">
            {[1, 2, 3].map(i => (
              <div 
                key={i} 
                style={{ 
                  width: size / 4, 
                  height: size / 4, 
                  backgroundColor: finalColor,
                  animationDelay: `${(i * 0.2).toFixed(1)}s`,
                  animationDuration: `${duration}s`
                }} 
              />
            ))}
          </div>
        );
      case 'bar':
        return (
          <div className="retro-loader-bar" style={{ width: '100%', height: thickness, border: `1px solid ${finalColor}` }}>
            <div style={{ backgroundColor: finalColor, animationDuration: `${duration}s` }} />
          </div>
        );
      case 'bounce':
        return (
          <div className="retro-loader-bounce" style={{ width: size, height: size / 2 }}>
             <div style={{ width: size/3, height: size/3, backgroundColor: finalColor, animationDuration: `${duration}s` }} />
          </div>
        );
      case 'spinner':
      default:
        return (
          <div 
            className="retro-loader-spinner" 
            style={{ 
              width: size, 
              height: size, 
              border: `${thickness}px solid rgba(255,255,255,0.1)`,
              borderTopColor: finalColor,
              animationDuration: `${duration}s`
            }} 
          />
        );
    }
  };

  return (
    <div className="loader-container" style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      padding: 10,
      width: width,
      height: height,
      boxSizing: 'border-box'
    }}>
      {renderLoader()}
    </div>
  );
}

export default Loader;
