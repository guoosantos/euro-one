import React from "react";

export default function Input({ className = "", ...props }) {
  return (
    <input
      className={
        "w-full px-3 py-2 rounded border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 " +
        className
      }
      {...props}
    />
  );
}
