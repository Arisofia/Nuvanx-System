import React from 'react';
import './tokens.css';
import './card.css';

export default { title: 'Components/Card' };

export const ServiceCard = () => (
  <div className="card">
    <div className="card__media" />
    <h3 className="card__title">Endolift Papada</h3>
    <p className="card__desc">Resultados naturales · Valoración médica previa</p>
    <button className="btn btn--secondary">Solicitar valoración</button>
  </div>
);
