import React from 'react'
export default function Select(props){
  return (
    <select {...props}
      className="bg-card/60 border border-stroke rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30">
      {props.children}
    </select>
  )
}
