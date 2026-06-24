<?php
/**
 * Plugin Name: NUVANX · Phase 4D · GEO Entity Bridge
 * Description: Añade Organization + MedicalClinic + sedes + Physician + relación de página solo en URLs con déficit GEO. No toca páginas ya fuertes.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

function nvx_phase4d_geo_target_ids(): array {
    return [
        974,   // medicina-estetica
        1594,  // thermage
        2017,  // laser co2
        1241,  // endolift facial
        1200,  // endolaser corporal
        1593,  // 72h post-endolift
        1592,  // well-aging
        1591,  // ciencia endolift
    ];
}

function nvx_phase4d_geo_is_target(): bool {
    if (is_admin() || wp_doing_ajax() || wp_is_json_request()) {
        return false;
    }

    $id = (int) get_queried_object_id();

    return in_array($id, nvx_phase4d_geo_target_ids(), true);
}

function nvx_phase4d_geo_base_graph(): array {
    $org_id     = 'https://nuvanx.com/#organization';
    $clinic_id  = 'https://nuvanx.com/#medicalclinic';
    $chamberi   = 'https://nuvanx.com/medicina-estetica-chamberi/#medicalclinic';
    $goya       = 'https://nuvanx.com/clinicas-de-medicina-estetica-nuvanx/medicina-estetica-goya-barrio-salamanca/#medicalclinic';
    $physician  = 'https://nuvanx.com/equipo-medico/#javier-rivera';

    $knows = [
        'Medicina estética',
        'Medicina estética láser',
        'Medicina estética en Madrid',
        'Medicina estética en Chamberí',
        'Medicina estética en Goya',
        'Medicina estética Barrio Salamanca',
        'Endolift',
        'Endolifting',
        'Endolift Madrid',
        'Endolift facial',
        'Endoláser corporal',
        'Laserlipólisis',
        'Smartlipo DEKA',
        'LaseMaR1500',
        'Thermage FLX',
        'Láser CO2 fraccionado',
        'Well-aging',
        'Bioestimulación',
        'Calidad de piel',
        'Rejuvenecimiento facial',
        'Remodelación corporal sin cirugía',
    ];

    $area = [
        'Madrid',
        'Chamberí',
        'Goya',
        'Barrio Salamanca',
        'Chamartín',
        'El Viso',
        'Almagro',
        'Retiro',
        'Pozuelo de Alarcón',
        'Aravaca',
        'Majadahonda',
        'Boadilla del Monte',
    ];

    return [
        [
            '@type' => ['Organization', 'MedicalOrganization'],
            '@id' => $org_id,
            'name' => 'NUVANX Medicina Estética Láser',
            'url' => 'https://nuvanx.com/',
            'logo' => [
                '@type' => 'ImageObject',
                '@id' => 'https://nuvanx.com/#logo',
                'url' => 'https://nuvanx.com/wp-content/uploads/2026/06/LOGO-NUVANX.png',
            ],
            'description' => 'Clínica de medicina estética láser en Madrid con sedes en Chamberí y Goya · Barrio Salamanca.',
            'sameAs' => [
                'https://www.doctoralia.es/clinicas/nuvanx-medicina-estetica-laser',
                'https://www.facebook.com/people/Nuvanx/61575759205398/',
                'https://www.instagram.com/nuvanx_/',
                'https://www.instagram.com/nuvanx_goya/',
                'https://www.tiktok.com/@nuvanx_medicina_estetica',
            ],
            'knowsAbout' => $knows,
            'areaServed' => $area,
        ],
        [
            '@type' => ['MedicalClinic', 'MedicalBusiness'],
            '@id' => $clinic_id,
            'name' => 'NUVANX Medicina Estética Láser',
            'url' => 'https://nuvanx.com/',
            'description' => 'Clínica de medicina estética láser en Madrid con diagnóstico médico-estético, tecnología láser y protocolos personalizados.',
            'medicalSpecialty' => [
                'Medicina estética',
                'Medicina estética láser',
                'Medicina estética facial',
                'Medicina estética corporal',
                'Endolift',
                'Endoláser corporal',
                'Thermage FLX',
                'Láser CO2 fraccionado',
                'Well-aging',
            ],
            'parentOrganization' => ['@id' => $org_id],
            'department' => [
                ['@id' => $chamberi],
                ['@id' => $goya],
            ],
            'employee' => [
                ['@id' => $physician],
            ],
            'knowsAbout' => $knows,
            'areaServed' => $area,
            'sameAs' => [
                'https://www.doctoralia.es/clinicas/nuvanx-medicina-estetica-laser',
            ],
        ],
        [
            '@type' => ['MedicalClinic', 'MedicalBusiness'],
            '@id' => $chamberi,
            'name' => 'NUVANX Chamberí',
            'url' => 'https://nuvanx.com/medicina-estetica-chamberi/',
            'telephone' => '+34669319836',
            'address' => [
                '@type' => 'PostalAddress',
                'streetAddress' => 'Calle Fernández de la Hoz 4, Bajo Derecha',
                'postalCode' => '28010',
                'addressLocality' => 'Madrid',
                'addressCountry' => 'ES',
            ],
            'hasMap' => 'https://www.google.com/maps/search/?api=1&query=NUVANX%20Medicina%20Est%C3%A9tica%20L%C3%A1ser%20C%2F%20de%20Fern%C3%A1ndez%20de%20la%20Hoz%204%2028010%20Madrid',
            'medicalSpecialty' => [
                'Medicina estética láser',
                'Endolift',
                'Endoláser corporal',
                'Láser CO2 fraccionado',
                'Medicina estética facial y corporal',
            ],
            'parentOrganization' => ['@id' => $org_id],
        ],
        [
            '@type' => ['MedicalClinic', 'MedicalBusiness'],
            '@id' => $goya,
            'name' => 'NUVANX Goya · Barrio Salamanca',
            'url' => 'https://nuvanx.com/clinicas-de-medicina-estetica-nuvanx/medicina-estetica-goya-barrio-salamanca/',
            'telephone' => '+34647505107',
            'address' => [
                '@type' => 'PostalAddress',
                'streetAddress' => 'Calle Fernán González 26',
                'postalCode' => '28009',
                'addressLocality' => 'Madrid',
                'addressCountry' => 'ES',
            ],
            'hasMap' => 'https://www.google.com/maps/search/?api=1&query=NUVANX%20Goya%20C%2F%20de%20Fern%C3%A1n%20Gonz%C3%A1lez%2026%2028009%20Madrid',
            'medicalSpecialty' => [
                'Medicina estética',
                'Estética avanzada',
                'Thermage FLX',
                'Well-aging',
                'Medicina estética láser',
            ],
            'parentOrganization' => ['@id' => $org_id],
        ],
        [
            '@type' => ['Physician', 'Person'],
            '@id' => $physician,
            'name' => 'Dr. José Javier Rivera Tejeda',
            'url' => 'https://nuvanx.com/equipo-medico/#dr-jose-javier-rivera-tejeda',
            'jobTitle' => 'Médico estético',
            'medicalSpecialty' => [
                'Medicina estética',
                'Medicina estética láser',
                'Tricología',
                'Medicina capilar',
            ],
            'worksFor' => ['@id' => $clinic_id],
            'affiliation' => ['@id' => $org_id],
            'sameAs' => [
                'https://www.doctoralia.es/jose-javier-rivera-tejeda/medico-estetico/madrid',
            ],
            'knowsAbout' => [
                'Medicina estética láser',
                'Endolift',
                'Endoláser',
                'Endolifting',
                'Láser subdérmico',
                'Láser CO2 fraccionado',
                'Tricología',
                'Cirugía capilar',
                'Rejuvenecimiento facial',
                'Remodelación corporal sin cirugía',
            ],
        ],
    ];
}

function nvx_phase4d_geo_page_node(): array {
    $id = (int) get_queried_object_id();
    $url = get_permalink($id);
    $title = wp_strip_all_tags(get_the_title($id));
    $org_id = 'https://nuvanx.com/#organization';
    $clinic_id = 'https://nuvanx.com/#medicalclinic';
    $physician = 'https://nuvanx.com/equipo-medico/#javier-rivera';

    $is_post = is_singular('post');

    $type = $is_post ? ['BlogPosting', 'MedicalWebPage'] : ['WebPage', 'MedicalWebPage'];

    $node = [
        '@type' => $type,
        '@id' => trailingslashit($url) . '#geo-page',
        'url' => $url,
        'name' => $title,
        'headline' => $title,
        'isPartOf' => ['@id' => 'https://nuvanx.com/#website'],
        'publisher' => ['@id' => $org_id],
        'provider' => ['@id' => $clinic_id],
        'about' => [
            ['@id' => $clinic_id],
        ],
        'reviewedBy' => ['@id' => $physician],
        'inLanguage' => 'es-ES',
    ];

    if ($is_post) {
        $node['author'] = ['@id' => $physician];
        $node['mainEntityOfPage'] = [
            '@type' => 'WebPage',
            '@id' => $url,
        ];
    }

    $service_map = [
        974 => [
            'name' => 'Medicina estética en Madrid',
            'url' => 'https://nuvanx.com/medicina-estetica/',
            'serviceType' => 'Medicina estética',
        ],
        1594 => [
            'name' => 'Thermage FLX en Madrid',
            'url' => 'https://nuvanx.com/thermage-flx-radiofrecuencia-monopolar-madrid/',
            'serviceType' => 'Radiofrecuencia monopolar Thermage FLX',
        ],
        2017 => [
            'name' => 'Láser CO2 fraccionado en Madrid',
            'url' => 'https://nuvanx.com/laser-co2-fraccionado-madrid-textura-cicatrices-poro/',
            'serviceType' => 'Láser CO2 fraccionado',
        ],
        1241 => [
            'name' => 'Endolift facial en Madrid',
            'url' => 'https://nuvanx.com/endolift-facial-el-lifting-sin-cirugia-que-revoluciona-la-medicina-estetica/',
            'serviceType' => 'Endolift facial',
        ],
        1200 => [
            'name' => 'Endoláser corporal en Madrid',
            'url' => 'https://nuvanx.com/endolaser-corporal-la-revolucion-cientifica-para-eliminar-grasa-y-reafirmar-la-piel/',
            'serviceType' => 'Endoláser corporal',
        ],
        1593 => [
            'name' => 'Recuperación post-Endolift',
            'url' => 'https://nuvanx.com/72-horas-post-endolift-protocolo-recuperacion/',
            'serviceType' => 'Seguimiento post-Endolift',
        ],
        1592 => [
            'name' => 'Well-aging médico-estético',
            'url' => 'https://nuvanx.com/well-aging-48-descenso-estrogenos/',
            'serviceType' => 'Well-aging',
        ],
        1591 => [
            'name' => 'Endolift y láser subdérmico',
            'url' => 'https://nuvanx.com/ciencia-endolift-laser-subdermico/',
            'serviceType' => 'Endolift láser subdérmico',
        ],
    ];

    $service = $service_map[$id] ?? null;

    if ($service) {
        $service_id = trailingslashit($service['url']) . '#service';

        $node['about'][] = ['@id' => $service_id];
        $node['mentions'] = [
            ['@id' => 'https://nuvanx.com/medicina-estetica-chamberi/#medicalclinic'],
            ['@id' => 'https://nuvanx.com/clinicas-de-medicina-estetica-nuvanx/medicina-estetica-goya-barrio-salamanca/#medicalclinic'],
            ['@id' => $physician],
        ];

        return [
            $node,
            [
                '@type' => ['Service', 'MedicalProcedure'],
                '@id' => $service_id,
                'name' => $service['name'],
                'url' => $service['url'],
                'serviceType' => $service['serviceType'],
                'provider' => ['@id' => $clinic_id],
                'areaServed' => [
                    'Madrid',
                    'Chamberí',
                    'Goya',
                    'Barrio Salamanca',
                    'Pozuelo de Alarcón',
                    'Aravaca',
                    'Majadahonda',
                    'Boadilla del Monte',
                ],
                'availableChannel' => [
                    '@type' => 'ServiceChannel',
                    'serviceUrl' => $service['url'],
                    'servicePhone' => '+34669319836',
                ],
            ],
        ];
    }

    return [$node];
}

function nvx_phase4d_geo_render_script(): string {
    $graph = array_merge(
        nvx_phase4d_geo_base_graph(),
        nvx_phase4d_geo_page_node()
    );

    $schema = [
        '@context' => 'https://schema.org',
        '@graph' => $graph,
    ];

    $json = wp_json_encode($schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if (!$json) {
        return '';
    }

    return "\n<!-- NVX_PHASE4D_GEO_ENTITY_BRIDGE_ACTIVE -->\n"
        . '<script type="application/ld+json" id="nvx-phase4d-geo-entity-bridge">'
        . $json
        . "</script>\n";
}

function nvx_phase4d_geo_inject_schema(string $html): string {
    if (!nvx_phase4d_geo_is_target()) {
        return $html;
    }

    if (stripos($html, 'id="nvx-phase4d-geo-entity-bridge"') !== false) {
        return $html;
    }

    $script = nvx_phase4d_geo_render_script();

    if ($script === '') {
        return $html;
    }

    if (stripos($html, '</head>') !== false) {
        return str_ireplace('</head>', $script . '</head>', $html);
    }

    return $script . $html;
}

add_action('template_redirect', function () {
    if (!nvx_phase4d_geo_is_target()) {
        return;
    }

    ob_start('nvx_phase4d_geo_inject_schema');
}, 1);