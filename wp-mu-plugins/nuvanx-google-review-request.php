<?php
/**
 * Plugin Name: NUVANX · Google Review Request
 * Description: Adds a compliance-safe Google review request block when real Google Business Profile review links are configured.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

function nvx_google_review_chamberi_url(): string {
    if (defined('NVX_GOOGLE_REVIEW_CHAMBERI_URL') && NVX_GOOGLE_REVIEW_CHAMBERI_URL) {
        return esc_url_raw((string) NVX_GOOGLE_REVIEW_CHAMBERI_URL);
    }

    return esc_url_raw((string) get_option('nvx_google_review_chamberi_url', ''));
}

function nvx_google_review_goya_url(): string {
    if (defined('NVX_GOOGLE_REVIEW_GOYA_URL') && NVX_GOOGLE_REVIEW_GOYA_URL) {
        return esc_url_raw((string) NVX_GOOGLE_REVIEW_GOYA_URL);
    }

    return esc_url_raw((string) get_option('nvx_google_review_goya_url', ''));
}

function nvx_google_review_has_any_link(): bool {
    return (bool) (nvx_google_review_chamberi_url() || nvx_google_review_goya_url());
}

function nvx_google_review_auto_pages(): array {
    return [
        9,     // Home
        14,    // Contacto
        1575,  // Equipo médico
        1656,  // Nosotros
        1537,  // Goya
    ];
}

function nvx_google_review_request_html(string $variant = 'default'): string {
    $chamberi = nvx_google_review_chamberi_url();
    $goya = nvx_google_review_goya_url();

    if (!$chamberi && !$goya) {
        return '';
    }

    ob_start();
    ?>
    <section class="nvx-google-review-request nvx-google-review-request--<?php echo esc_attr($variant); ?>" aria-labelledby="nvx-google-review-request-title">
      <div class="nvx-google-review-request__inner">
        <p class="nvx-google-review-request__kicker">Reseñas en Google</p>
        <h2 id="nvx-google-review-request-title">Tu experiencia ayuda a otros pacientes a elegir con más confianza</h2>
        <p class="nvx-google-review-request__lead">
          Si ya has visitado NUVANX, puedes compartir tu experiencia real en Google. No hace falta mencionar datos médicos personales: basta con valorar la atención, la claridad de la explicación y el trato recibido.
        </p>
        <div class="nvx-google-review-request__actions">
          <?php if ($chamberi): ?>
            <a class="nvx-google-review-request__button" href="<?php echo esc_url($chamberi); ?>" target="_blank" rel="nofollow noopener external">
              Reseñar NUVANX Chamberí
            </a>
          <?php endif; ?>
          <?php if ($goya): ?>
            <a class="nvx-google-review-request__button nvx-google-review-request__button--secondary" href="<?php echo esc_url($goya); ?>" target="_blank" rel="nofollow noopener external">
              Reseñar NUVANX Goya
            </a>
          <?php endif; ?>
        </div>
        <p class="nvx-google-review-request__note">
          Las reseñas deben reflejar una experiencia auténtica. NUVANX no ofrece incentivos por publicar reseñas ni solicita valoraciones positivas de forma selectiva.
        </p>
      </div>
    </section>
    <?php
    return trim((string) ob_get_clean());
}

add_shortcode('nvx_google_review_request', function ($atts = []) {
    $atts = shortcode_atts([
        'variant' => 'shortcode',
    ], $atts, 'nvx_google_review_request');

    return nvx_google_review_request_html((string) $atts['variant']);
});

add_filter('the_content', function ($content) {
    if (is_admin() || !is_singular() || !nvx_google_review_has_any_link()) {
        return $content;
    }

    $post_id = (int) get_the_ID();

    if (!in_array($post_id, nvx_google_review_auto_pages(), true)) {
        return $content;
    }

    if (strpos((string) $content, 'nvx-google-review-request') !== false) {
        return $content;
    }

    $block = nvx_google_review_request_html('auto');

    return (string) $content . "\n" . $block;
}, 45);

add_action('wp_head', function () {
    if (!nvx_google_review_has_any_link()) {
        return;
    }
    ?>
    <style id="nvx-google-review-request-2026">
      .nvx-google-review-request {
        background:#171717 !important;
        color:#F7F1E8 !important;
        padding:clamp(38px,5vw,74px) 20px !important;
        border-top:1px solid rgba(247,241,232,.12) !important;
        border-bottom:1px solid rgba(247,241,232,.12) !important;
      }
      .nvx-google-review-request__inner {
        width:min(1080px,100%) !important;
        margin:0 auto !important;
      }
      .nvx-google-review-request__kicker {
        margin:0 0 10px !important;
        color:#B89A5B !important;
        font-size:12px !important;
        letter-spacing:.16em !important;
        text-transform:uppercase !important;
        font-weight:700 !important;
      }
      .nvx-google-review-request h2 {
        margin:0 0 18px !important;
        max-width:820px !important;
        color:#F7F1E8 !important;
        font-size:clamp(28px,3.6vw,48px) !important;
        line-height:1.04 !important;
        letter-spacing:-.035em !important;
        font-weight:500 !important;
      }
      .nvx-google-review-request__lead {
        max-width:780px !important;
        margin:0 0 24px !important;
        color:#E9DDCF !important;
        font-size:clamp(15px,1.8vw,18px) !important;
        line-height:1.58 !important;
      }
      .nvx-google-review-request__actions {
        display:flex !important;
        flex-wrap:wrap !important;
        gap:12px !important;
        margin:0 0 18px !important;
      }
      .nvx-google-review-request__button {
        display:inline-flex !important;
        align-items:center !important;
        justify-content:center !important;
        min-height:46px !important;
        padding:13px 18px !important;
        text-decoration:none !important;
        background:#F7F1E8 !important;
        color:#171717 !important;
        font-size:12px !important;
        letter-spacing:.08em !important;
        text-transform:uppercase !important;
        font-weight:700 !important;
      }
      .nvx-google-review-request__button--secondary {
        background:transparent !important;
        color:#F7F1E8 !important;
        border:1px solid rgba(247,241,232,.38) !important;
      }
      .nvx-google-review-request__note {
        max-width:760px !important;
        margin:0 !important;
        color:#CBBBA8 !important;
        font-size:12px !important;
        line-height:1.55 !important;
      }
      @media (max-width:780px) {
        .nvx-google-review-request__actions {
          flex-direction:column !important;
        }
        .nvx-google-review-request__button {
          width:100% !important;
        }
      }
    </style>
    <?php
}, 1000030);
