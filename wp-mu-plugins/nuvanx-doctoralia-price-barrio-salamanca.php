<?php
/**
 * Plugin Name: NUVANX · Doctoralia Price + Barrio Salamanca SEO
 * Description: Adds compliance-safe price transparency and Barrio Salamanca local SEO blocks for Endolift and Goya pages.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

function nvx_doctoralia_price_public_url(): string {
    $url = (string) get_option('nvx_doctoralia_endolift_url', 'https://www.doctoralia.es/clinicas/nuvanx-medicina-estetica-laser');
    return esc_url_raw($url);
}

function nvx_doctoralia_price_endolift_value(): string {
    $price = (string) get_option('nvx_doctoralia_endolift_price', '1.895 €');
    return trim($price);
}

function nvx_doctoralia_price_pages(): array {
    return [
        1241,  // Endolift facial
        1269,  // Medicina estética láser
        1537,  // Goya Barrio Salamanca
        9,     // Home
    ];
}

function nvx_barrio_salamanca_seo_pages(): array {
    return [
        1537,  // Goya Barrio Salamanca
        1269,  // Medicina estética láser
        1241,  // Endolift facial
        9,     // Home
    ];
}

function nvx_doctoralia_price_block_html(string $variant = 'default'): string {
    $price = nvx_doctoralia_price_endolift_value();
    $url = nvx_doctoralia_price_public_url();

    if (!$price) {
        return '';
    }

    ob_start();
    ?>
    <!-- NVX_DOCTORALIA_PRICE_BLOCK_START -->
    <section class="nvx-doctoralia-price nvx-doctoralia-price--<?php echo esc_attr($variant); ?>" aria-labelledby="nvx-doctoralia-price-title">
      <div class="nvx-doctoralia-price__inner">
        <p class="nvx-doctoralia-price__kicker">Transparencia antes de la valoración</p>
        <h2 id="nvx-doctoralia-price-title">Precio claro para Endolift® publicado como referencia externa</h2>
        <p class="nvx-doctoralia-price__lead">
          En Doctoralia, NUVANX muestra una referencia pública de precio para Endolift®: <strong><?php echo esc_html($price); ?></strong>. El presupuesto final siempre se confirma tras valoración médica, según zona, anatomía, indicación y plan recomendado.
        </p>
        <div class="nvx-doctoralia-price__points" aria-label="Condiciones de transparencia del precio">
          <span>Referencia pública</span>
          <span>Valoración médica previa</span>
          <span>Sin promesas genéricas</span>
          <span>Presupuesto confirmado por caso</span>
        </div>
        <div class="nvx-doctoralia-price__actions">
          <a class="nvx-doctoralia-price__button" href="<?php echo esc_url($url); ?>" target="_blank" rel="nofollow noopener external">
            Ver referencia en Doctoralia
          </a>
          <a class="nvx-doctoralia-price__link" href="https://wa.me/34669319836" rel="nofollow noopener">
            Solicitar valoración médica gratuita
          </a>
        </div>
      </div>
    </section>
    <!-- NVX_DOCTORALIA_PRICE_BLOCK_END -->
    <?php
    return trim((string) ob_get_clean());
}

function nvx_barrio_salamanca_seo_block_html(string $variant = 'default'): string {
    ob_start();
    ?>
    <!-- NVX_BARRIO_SALAMANCA_SEO_BLOCK_START -->
    <section class="nvx-barrio-salamanca-seo nvx-barrio-salamanca-seo--<?php echo esc_attr($variant); ?>" aria-labelledby="nvx-barrio-salamanca-seo-title">
      <div class="nvx-barrio-salamanca-seo__inner">
        <p class="nvx-barrio-salamanca-seo__kicker">Medicina estética en Goya · Barrio Salamanca</p>
        <h2 id="nvx-barrio-salamanca-seo-title">Endolift®, láser médico y rejuvenecimiento facial en Barrio Salamanca</h2>
        <p class="nvx-barrio-salamanca-seo__lead">
          La sede NUVANX Goya permite atender pacientes que buscan medicina estética láser en Barrio Salamanca, Goya, Retiro, Ibiza, Lista y zonas cercanas, con valoración profesional antes de indicar Endolift®, láser CO2, Thermage FLX o protocolos combinados.
        </p>
        <div class="nvx-barrio-salamanca-seo__grid">
          <article>
            <h3>Endolift® Barrio Salamanca</h3>
            <p>Valoración de papada, cuello, óvalo facial y definición mandibular con criterio médico-estético.</p>
          </article>
          <article>
            <h3>Medicina estética Goya</h3>
            <p>Atención en C/ de Fernán González, 26, próxima a Goya y al entorno premium de Barrio Salamanca.</p>
          </article>
          <article>
            <h3>Rejuvenecimiento facial Madrid</h3>
            <p>Protocolos orientados a calidad de piel, firmeza, textura y naturalidad, según valoración previa.</p>
          </article>
        </div>
        <a class="nvx-barrio-salamanca-seo__button" href="https://nuvanx.com/clinicas-de-medicina-estetica-nuvanx/medicina-estetica-goya-barrio-salamanca/">
          Ver clínica NUVANX Goya · Barrio Salamanca
        </a>
      </div>
    </section>
    <!-- NVX_BARRIO_SALAMANCA_SEO_BLOCK_END -->
    <?php
    return trim((string) ob_get_clean());
}

add_shortcode('nvx_doctoralia_price_block', function ($atts = []) {
    $atts = shortcode_atts(['variant' => 'shortcode'], $atts, 'nvx_doctoralia_price_block');
    return nvx_doctoralia_price_block_html((string) $atts['variant']);
});

add_shortcode('nvx_barrio_salamanca_seo_block', function ($atts = []) {
    $atts = shortcode_atts(['variant' => 'shortcode'], $atts, 'nvx_barrio_salamanca_seo_block');
    return nvx_barrio_salamanca_seo_block_html((string) $atts['variant']);
});

add_filter('the_content', function ($content) {
    if (is_admin() || !is_singular()) {
        return $content;
    }

    $post_id = (int) get_the_ID();
    $append = '';

    if (in_array($post_id, nvx_doctoralia_price_pages(), true) && strpos((string) $content, 'NVX_DOCTORALIA_PRICE_BLOCK_START') === false) {
        $append .= "\n" . nvx_doctoralia_price_block_html('auto');
    }

    if (in_array($post_id, nvx_barrio_salamanca_seo_pages(), true) && strpos((string) $content, 'NVX_BARRIO_SALAMANCA_SEO_BLOCK_START') === false) {
        $append .= "\n" . nvx_barrio_salamanca_seo_block_html('auto');
    }

    return (string) $content . $append;
}, 47);

add_action('wp_head', function () {
    ?>
    <style id="nvx-doctoralia-price-barrio-salamanca-2026">
      .nvx-doctoralia-price,
      .nvx-barrio-salamanca-seo {
        padding:clamp(42px,6vw,82px) 20px !important;
        border-top:1px solid rgba(23,23,23,.08) !important;
        border-bottom:1px solid rgba(23,23,23,.08) !important;
      }
      .nvx-doctoralia-price {
        background:#F7F1E8 !important;
        color:#171717 !important;
      }
      .nvx-barrio-salamanca-seo {
        background:#fffaf2 !important;
        color:#171717 !important;
      }
      .nvx-doctoralia-price__inner,
      .nvx-barrio-salamanca-seo__inner {
        width:min(1120px,100%) !important;
        margin:0 auto !important;
      }
      .nvx-doctoralia-price__kicker,
      .nvx-barrio-salamanca-seo__kicker {
        margin:0 0 10px !important;
        color:#8B6E3F !important;
        font-size:12px !important;
        letter-spacing:.16em !important;
        text-transform:uppercase !important;
        font-weight:700 !important;
      }
      .nvx-doctoralia-price h2,
      .nvx-barrio-salamanca-seo h2 {
        margin:0 0 18px !important;
        max-width:860px !important;
        color:#171717 !important;
        font-size:clamp(30px,4vw,54px) !important;
        line-height:1.02 !important;
        letter-spacing:-.04em !important;
        font-weight:500 !important;
      }
      .nvx-doctoralia-price__lead,
      .nvx-barrio-salamanca-seo__lead {
        max-width:840px !important;
        margin:0 0 24px !important;
        color:#2B2926 !important;
        font-size:clamp(16px,2vw,20px) !important;
        line-height:1.56 !important;
      }
      .nvx-doctoralia-price__points,
      .nvx-barrio-salamanca-seo__grid {
        display:grid !important;
        grid-template-columns:repeat(4,minmax(0,1fr)) !important;
        gap:12px !important;
        margin:24px 0 28px !important;
      }
      .nvx-barrio-salamanca-seo__grid {
        grid-template-columns:repeat(3,minmax(0,1fr)) !important;
      }
      .nvx-doctoralia-price__points span,
      .nvx-barrio-salamanca-seo__grid article {
        background:#fff !important;
        border:1px solid rgba(23,23,23,.10) !important;
        padding:16px !important;
        box-shadow:0 18px 42px rgba(23,23,23,.05) !important;
      }
      .nvx-doctoralia-price__points span {
        font-size:12px !important;
        letter-spacing:.08em !important;
        text-transform:uppercase !important;
        font-weight:700 !important;
      }
      .nvx-barrio-salamanca-seo__grid h3 {
        margin:0 0 8px !important;
        font-size:18px !important;
        color:#171717 !important;
      }
      .nvx-barrio-salamanca-seo__grid p {
        margin:0 !important;
        color:#2B2926 !important;
        font-size:14px !important;
        line-height:1.55 !important;
      }
      .nvx-doctoralia-price__actions {
        display:flex !important;
        flex-wrap:wrap !important;
        gap:12px !important;
        align-items:center !important;
      }
      .nvx-doctoralia-price__button,
      .nvx-doctoralia-price__link,
      .nvx-barrio-salamanca-seo__button {
        display:inline-flex !important;
        align-items:center !important;
        justify-content:center !important;
        min-height:46px !important;
        padding:13px 18px !important;
        text-decoration:none !important;
        font-size:12px !important;
        letter-spacing:.08em !important;
        text-transform:uppercase !important;
        font-weight:700 !important;
      }
      .nvx-doctoralia-price__button,
      .nvx-barrio-salamanca-seo__button {
        background:#171717 !important;
        color:#F7F1E8 !important;
      }
      .nvx-doctoralia-price__link {
        background:transparent !important;
        color:#171717 !important;
        border:1px solid rgba(23,23,23,.24) !important;
      }
      @media (max-width:900px) {
        .nvx-doctoralia-price__points,
        .nvx-barrio-salamanca-seo__grid {
          grid-template-columns:1fr !important;
        }
        .nvx-doctoralia-price__actions {
          flex-direction:column !important;
          align-items:stretch !important;
        }
        .nvx-doctoralia-price__button,
        .nvx-doctoralia-price__link,
        .nvx-barrio-salamanca-seo__button {
          width:100% !important;
        }
      }
    </style>
    <?php
}, 1000040);
