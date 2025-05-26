import React from 'react';
import { FieldProps, WidgetProps, RegistryFieldsType, RegistryWidgetsType } from '@rjsf/utils';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

// Base Field Template
export const BaseFieldTemplate = (props: FieldProps) => {
  const {
    id,
    label,
    required,
    disabled,
    readonly,
    errors,
    help,
    description,
    children,
  } = props;

  return (
    <div className={cn("mb-4", errors && errors.length > 0 && "mb-6")}>
      {label && (
        <Label htmlFor={id} className="mb-2 block">
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </Label>
      )}
      {description && (
        <p className="text-sm text-slate-500 mb-2">{description}</p>
      )}
      {children}
      {errors && errors.length > 0 && (
        <p className="mt-1 text-sm text-red-600">{errors}</p>
      )}
      {help && <p className="mt-1 text-sm text-slate-500">{help}</p>}
    </div>
  );
};

// Text Widget
export const TextWidget = (props: WidgetProps) => {
  const { id, disabled, readonly, value, onChange, onBlur, onFocus, options, schema } = props;
  
  return (
    <Input
      id={id}
      type="text"
      disabled={disabled || readonly}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur && ((e) => onBlur(id, e.target.value))}
      onFocus={onFocus && ((e) => onFocus(id, e.target.value))}
      placeholder={options.placeholder}
    />
  );
};

// Password Widget
export const PasswordWidget = (props: WidgetProps) => {
  const { id, disabled, readonly, value, onChange, onBlur, onFocus, options } = props;
  
  return (
    <Input
      id={id}
      type="password"
      disabled={disabled || readonly}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur && ((e) => onBlur(id, e.target.value))}
      onFocus={onFocus && ((e) => onFocus(id, e.target.value))}
      placeholder={options.placeholder}
    />
  );
};

// Email Widget
export const EmailWidget = (props: WidgetProps) => {
  const { id, disabled, readonly, value, onChange, onBlur, onFocus, options } = props;
  
  return (
    <Input
      id={id}
      type="email"
      disabled={disabled || readonly}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur && ((e) => onBlur(id, e.target.value))}
      onFocus={onFocus && ((e) => onFocus(id, e.target.value))}
      placeholder={options.placeholder}
    />
  );
};

// Number Widget
export const NumberWidget = (props: WidgetProps) => {
  const { id, disabled, readonly, value, onChange, onBlur, onFocus, options, schema } = props;
  
  return (
    <Input
      id={id}
      type="number"
      disabled={disabled || readonly}
      value={value || ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      onBlur={onBlur && ((e) => onBlur(id, e.target.value ? Number(e.target.value) : undefined))}
      onFocus={onFocus && ((e) => onFocus(id, e.target.value ? Number(e.target.value) : undefined))}
      placeholder={options.placeholder}
      min={schema.minimum}
      max={schema.maximum}
      step={schema.multipleOf}
    />
  );
};

// Textarea Widget
export const TextareaWidget = (props: WidgetProps) => {
  const { id, disabled, readonly, value, onChange, onBlur, onFocus, options } = props;
  
  return (
    <Textarea
      id={id}
      disabled={disabled || readonly}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur && ((e) => onBlur(id, e.target.value))}
      onFocus={onFocus && ((e) => onFocus(id, e.target.value))}
      placeholder={options.placeholder}
      rows={options.rows || 5}
    />
  );
};

// Select Widget
export const SelectWidget = (props: WidgetProps) => {
  const { id, disabled, readonly, value, onChange, onBlur, onFocus, options, schema } = props;
  const { enumOptions } = options;
  
  return (
    <Select
      id={id}
      disabled={disabled || readonly}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur && ((e) => onBlur(id, e.target.value))}
      onFocus={onFocus && ((e) => onFocus(id, e.target.value))}
    >
      <option value="">Select...</option>
      {enumOptions && enumOptions.map(({ value, label }) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </Select>
  );
};

// Checkbox Widget
export const CheckboxWidget = (props: WidgetProps) => {
  const { id, disabled, readonly, value, onChange, label, schema } = props;
  
  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        id={id}
        disabled={disabled || readonly}
        checked={value || false}
        onChange={(e) => onChange(e.target.checked)}
      />
      {schema.title && (
        <Label htmlFor={id} className="text-sm font-normal cursor-pointer">
          {schema.title}
        </Label>
      )}
    </div>
  );
};

// Date Widget
export const DateWidget = (props: WidgetProps) => {
  const { id, disabled, readonly, value, onChange, onBlur, onFocus } = props;
  
  return (
    <Input
      id={id}
      type="date"
      disabled={disabled || readonly}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur && ((e) => onBlur(id, e.target.value))}
      onFocus={onFocus && ((e) => onFocus(id, e.target.value))}
    />
  );
};

// DateTime Widget
export const DateTimeWidget = (props: WidgetProps) => {
  const { id, disabled, readonly, value, onChange, onBlur, onFocus } = props;
  
  return (
    <Input
      id={id}
      type="datetime-local"
      disabled={disabled || readonly}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur && ((e) => onBlur(id, e.target.value))}
      onFocus={onFocus && ((e) => onFocus(id, e.target.value))}
    />
  );
};

// Submit Button
export const SubmitButton = ({ uiSchema }: { uiSchema?: any }) => {
  const submitText = uiSchema?.['ui:submitButtonOptions']?.submitText || 'Submit';
  
  return (
    <Button type="submit" className="w-full">
      {submitText}
    </Button>
  );
};

// Export the theme configuration
export const shadcnTheme = {
  fields: {} as RegistryFieldsType,
  widgets: {
    TextWidget,
    PasswordWidget,
    EmailWidget,
    NumberWidget,
    TextareaWidget,
    SelectWidget,
    CheckboxWidget,
    DateWidget,
    DateTimeWidget,
  } as RegistryWidgetsType,
  templates: {
    FieldTemplate: BaseFieldTemplate,
  },
};