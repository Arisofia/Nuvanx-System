import { InputHTMLAttributes } from 'react'

export function Input(props: Readonly<InputHTMLAttributes<HTMLInputElement>>) {
  return (
    <input
      className="input-field"
      {...props}
    />
  )
}
