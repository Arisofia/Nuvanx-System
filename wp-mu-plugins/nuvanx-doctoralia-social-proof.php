<?php
/**
 * Plugin Name: NUVANX · Doctoralia Social Proof
 * Description: Adds a compliance-safe Doctoralia public proof block to key NUVANX pages using the public 98-opinion Doctoralia source.
 * Version: 2.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

function nvx_doctoralia_social_proof_url(): string {
    return 'https://www.doctoralia.es/clinicas/nuvanx-medicina-estetica-laser-endolift';
}

function nvx_doctoralia_social_proof_count(): int {
    return 98;
}

function nvx_doctoralia_social_proof_pages(): array {
    return [
        9,     // Home
        1269,  // Medicina estética láser
        14,    // Contacto
        1575,  // Equipo médico
        1656,  // Nosotros
        1241,  // Endolift facial
        1200,  // Endoláser corporal
        2017,  // Láser CO2
    ];
}

function nvx_doctoralia_social_proof_html(string $variant = 'default'): string {
    $doctoralia_url = esc_url(nvx_doctoralia_social_proof_url());
    $count = nvx_doctoralia_social_proof_count();

    ob_start();
    ?>
    <!-- NVX_DOCTORALIA_SOCIAL_PROOF_V2_START -->
    <section class="nvx-doctoralia-proof nvx-doctoralia-proof--<?php echo esc_attr($variant); ?>" aria-labelledby="nvx-doctoralia-proof-title">
      <div class="nvx-doctoralia-proof__inner">
        <p class="nvx-doctoralia-proof__kicker">Opiniones verificadas</p>
        <div class="nvx-doctoralia-proof__headline-row" data-visual-line="doctoralia-proof-count">
          <h2 id="nvx-doctoralia-proof-title">Pacientes que han valorado NUVANX en Doctoralia</h2>
          <span class="nvx-doctoralia-proof__stat" aria-label="<?php echo esc_attr($count); ?> opiniones verificadas en Doctoralia">
            <?php echo esc_html((string) $count); ?> opiniones verificadas
          </span>
        </div>
        <p class="nvx-doctoralia-proof__lead">
          NUVANX cuenta con <?php echo esc_html((string) $count); ?> opiniones verificadas en Doctoralia. Las reseñas públicas incluyen experiencias recientes sobre Endolift®, atención médico-estética, explicación del procedimiento y trato del equipo antes de solicitar una valoración médica.
        </p>
        <div class="nvx-doctoralia-proof__grid">
          <article class="nvx-doctoralia-proof__card">
            <span class="nvx-doctoralia-proof__label">Endolift® · cita verificada</span>
            <p>
              Doctoralia muestra opiniones verificadas recientes asociadas a Técnica Endolift y al equipo NUVANX.
            </p>
            <p class="nvx-doctoralia-proof__meta">
              Fuente pública: Doctoralia · Opiniones sobre especialistas · 98 opiniones
            </p>
          </article>
          <article class="nvx-doctoralia-proof__card">
            <span class="nvx-doctoralia-proof__label">Criterio médico</span>
            <p>
              La ficha pública identifica como responsable sanitario al Dr. José Javier Rivera Tejeda y recoge equipamiento como LaseMaR1500/Endolift, Thermage®, DEKA y láser CO2 fraccionado.
            </p>
            <p class="nvx-doctoralia-proof__meta">
              Registro sanitario Chamberí: CS20144
            </p>
          </article>
        </div>
        <div class="nvx-doctoralia-proof__actions">
          <a class="nvx-doctoralia-proof__button" href="<?php echo $doctoralia_url; ?>" target="_blank" rel="nofollow noopener external">
            Ver 98 opiniones en Doctoralia
          </a>
          <a class="nvx-doctoralia-proof__link" href="https://wa.me/34669319836" rel="nofollow noopener">
            Solicitar valoración médica gratuita
          </a>
        </div>
      </div>
    </section>
    <!-- NVX_DOCTORALIA_SOCIAL_PROOF_V2_END -->
    <?php
    return trim((string) ob_get_clean());
}

add_shortcode('nvx_doctoralia_social_proof', function ($atts = []) {
    $atts = shortcode_atts([
        'variant' => 'shortcode',
    ], $atts, 'nvx_doctoralia_social_proof');

    return nvx_doctoralia_social_proof_html((string) $atts['variant']);
});

add_filter('the_content', function ($content) {
    if (is_admin() || !is_singular()) {
        return $content;
    }

    $post_id = (int) get_the_ID();

    if (!in_array($post_id, nvx_doctoralia_social_proof_pages(), true)) {
        return $content;
    }

    if (strpos((string) $content, 'NVX_DOCTORALIA_SOCIAL_PROOF_V2_START') !== false || strpos((string) $content, 'nvx-doctoralia-proof') !== false) {
        return $content;
    }

    $block = nvx_doctoralia_social_proof_html('auto');

    if ($post_id === 9 && strpos((string) $content, '</section>') !== false) {
        return preg_replace('/<\/section>/', '</section>' . "\n" . $block, (string) $content, 1);
    }

    return (string) $content . "\n" . $block;
}, 40);

add_action('wp_head', function () {
    ?>
    <style id="nvx-doctoralia-social-proof-2026-v2">
      .nvx-doctoralia-proof {
        background:#F7F1E8 !important;
        color:#171717 !important;
        padding:clamp(42px,6vw,84px) 20px !important;
        border-top:1px solid rgba(23,23,23,.08) !important;
        border-bottom:1px solid rgba(23,23,23,.08) !important;
      }
      .nvx-doctoralia-proof__inner {
        width:min(1120px,100%) !important;
        margin:0 auto !important;
      }
      .nvx-doctoralia-proof__kicker {
        margin:0 0 10px !important;
        color:#8B6E3F !important;
        font-size:12px !important;
        letter-spacing:.16em !important;
        text-transform:uppercase !important;
        font-weight:700 !important;
      }
      .nvx-doctoralia-proof__headline-row {
        display:flex !important;
        align-items:flex-end !important;
        justify-content:space-between !important;
        gap:18px !important;
        width:100% !important;
        max-width:100% !important;
        margin:0 0 18px !important;
        padding-bottom:18px !important;
        border-bottom:1px solid rgba(23,23,23,.12) !important;
      }
      .nvx-doctoralia-proof h2 {
        margin:0 !important;
        max-width:760px !important;
        color:#171717 !important;
        font-size:clamp(30px,4vw,54px) !important;
        line-height:1.02 !important;
        letter-spacing:-.04em !important;
        font-weight:500 !important;
        flex:1 1 auto !important;
        min-width:0 !important;
      }
      .nvx-doctoralia-proof__stat {
        display:inline-flex !important;
        align-items:center !important;
        justify-content:center !important;
        flex:0 0 auto !important;
        width:auto !important;
        max-width:max-content !important;
        min-height:42px !important;
        padding:10px 14px !important;
        border:1px solid rgba(23,23,23,.18) !important;
        border-radius:999px !important;
        background:#fffaf2 !important;
        color:#171717 !important;
        box-shadow:0 14px 34px rgba(23,23,23,.05) !important;
        font-size:12px !important;
        line-height:1 !important;
        letter-spacing:.08em !important;
        text-transform:uppercase !important;
        font-weight:700 !important;
        white-space:nowrap !important;
      }
      .nvx-doctoralia-proof__lead {
        max-width:820px !important;
        margin:0 0 28px !important;
        color:#2B2926 !important;
        font-size:clamp(16px,2vw,20px) !important;
        line-height:1.55 !important;
      }
      .nvx-doctoralia-proof__grid {
        display:grid !important;
        grid-template-columns:repeat(2,minmax(0,1fr)) !important;
        gap:18px !important;
        margin:28px 0 28px !important;
      }
      .nvx-doctoralia-proof__card {
        background:#fffaf2 !important;
        border:1px solid rgba(23,23,23,.10) !important;
        padding:24px !important;
        box-shadow:0 18px 48px rgba(23,23,23,.06) !important;
      }
      .nvx-doctoralia-proof__label {
        display:inline-block !important;
        margin:0 0 12px !important;
        color:#8B6E3F !important;
        font-size:11px !important;
        letter-spacing:.14em !important;
        text-transform:uppercase !important;
        font-weight:700 !important;
      }
      .nvx-doctoralia-proof__card p {
        margin:0 0 12px !important;
        color:#2B2926 !important;
        font-size:15px !important;
        line-height:1.55 !important;
      }
      .nvx-doctoralia-proof__meta {
        margin:0 !important;
        color:#6C6258 !important;
        font-size:12px !important;
      }
      .nvx-doctoralia-proof__actions {
        display:flex !important;
        flex-wrap:wrap !important;
        gap:12px !important;
        align-items:center !important;
      }
      .nvx-doctoralia-proof__button,
      .nvx-doctoralia-proof__link {
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
      .nvx-doctoralia-proof__button {
        background:#171717 !important;
        color:#F7F1E8 !important;
      }
      .nvx-doctoralia-proof__link {
        background:transparent !important;
        color:#171717 !important;
        border:1px solid rgba(23,23,23,.24) !important;
      }
      @media (max-width:780px) {
        .nvx-doctoralia-proof__headline-row {
          align-items:flex-start !important;
          flex-direction:column !important;
          gap:12px !important;
        }
        .nvx-doctoralia-proof__stat {
          max-width:100% !important;
          white-space:normal !important;
          line-height:1.2 !important;
        }
        .nvx-doctoralia-proof__grid {
          grid-template-columns:1fr !important;
        }
        .nvx-doctoralia-proof__actions {
          align-items:stretch !important;
          flex-direction:column !important;
        }
        .nvx-doctoralia-proof__button,
        .nvx-doctoralia-proof__link {
          width:100% !important;
        }
      }
    </style>
    <?php
}, 1000020);
