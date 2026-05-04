import React from 'react';
import PropTypes from 'prop-types';
import './tokens.css';
import './button.css';

export default {
  title: 'Components/Button',
  component: Button,
};

export const Primary = () => <Button variant="primary">Asegura tu cita</Button>;
export const Secondary = () => <Button variant="secondary">Solicita valoración</Button>;
export const WhatsApp = () => <Button variant="whatsapp" aria-label="Contactar por WhatsApp">WhatsApp</Button>;

/* Button component (inline for Storybook demo) */
function Button({ variant = 'primary', children, ...props }) {
  return (
    <button className={`btn btn--${variant}`} {...props}>
      {children}
    </button>
  );
}

Button.propTypes = {
  variant: PropTypes.string,
  children: PropTypes.node.isRequired,
};
