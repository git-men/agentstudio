import * as React from "react"

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      onCheckedChange?.(event.target.checked)
    }

    return (
      <label
        className={`relative inline-flex items-center cursor-pointer ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        <input
          type="checkbox"
          ref={ref}
          checked={checked}
          onChange={handleChange}
          disabled={disabled}
          className="sr-only peer"
          {...props}
        />
        <div
          className={`
            w-11 h-6 bg-gray-200 dark:bg-gray-700 
            peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 peer-focus:ring-offset-2
            dark:peer-focus:ring-offset-gray-800
            rounded-full peer 
            peer-checked:after:translate-x-full peer-checked:after:border-white 
            after:content-[''] after:absolute after:top-[2px] after:left-[2px] 
            after:bg-white after:border-gray-300 after:border after:rounded-full 
            after:h-5 after:w-5 after:transition-all 
            peer-checked:bg-blue-600 dark:peer-checked:bg-blue-500
            ${className || ''}
          `}
        />
      </label>
    )
  }
)
Switch.displayName = "Switch"

export { Switch }
