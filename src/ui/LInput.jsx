import React from 'react';
export default function LInput({label, className='', ...props}) {
  return (<div className="lwrap"><span className="legend">{label}</span><input className={`linput ${className}`} {...props}/></div>);
}
