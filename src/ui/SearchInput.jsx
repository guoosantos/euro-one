import React from 'react';
export default function SearchInput({placeholder='Buscar...', value, onChange, className='', ...props}){
  return (<div className={`pill ${className}`}><svg className="icon" viewBox="0 0 24 24" fill="none"><path d="M21 21l-4.35-4.35m1.35-6.65a7 7 0 11-14 0 7 7 0 0114 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg><input placeholder={placeholder} value={value} onChange={onChange} {...props}/></div>);
}
