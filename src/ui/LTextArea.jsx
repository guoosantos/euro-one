import React from 'react';
export default function LTextArea({label, className='', ...props}) {
  return (<div className="lwrap"><span className="legend">{label}</span><textarea className={`ltextarea ${className}`} {...props}/></div>);
}
