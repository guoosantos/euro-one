import React from 'react';
export default function SelectPill({children, className='', ...props}){
  return <select className={`pill-select ${className}`} {...props}>{children}</select>;
}
