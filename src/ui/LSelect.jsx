import React from 'react';
export default function LSelect({label, className='', children, ...props}) {
  return (<div className="lwrap"><span className="legend">{label}</span><select className={`lselect ${className}`} {...props}>{children}</select></div>);
}
