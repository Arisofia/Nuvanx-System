<?php
/**
 * Yoast graph extensions for the four canonical facial treatment pages.
 *
 * @package nuvanx-medical
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Replace a graph node by @id or append it. */
function nvx_aesthetic_schema_upsert_node( array $graph, array $node ): array {
	$id = isset( $node['@id'] ) ? (string) $node['@id'] : '';
	if ( '' !== $id ) {
		foreach ( $graph as $index => $piece ) {
			if ( isset( $piece['@id'] ) && $id === (string) $piece['@id'] ) {
				$graph[ $index ] = $node;
				return $graph;
			}
		}
	}
	$graph[] = $node;
	return $graph;
}

/**
 * Map string names to Schema.org typed nodes.
 *
 * @param array<int,string> $names Display names.
 * @return array<int,array{@type:string,name:string}>
 */
function nvx_aesthetic_schema_named_nodes( array $names, string $type ): array {
	$nodes = array();
	foreach ( $names as $name ) {
		$nodes[] = array(
			'@type' => $type,
			'name'  => $name,
		);
	}
	return $nodes;
}

/**
 * Build the MedicalProcedure/Service node for a facial treatment page.
 *
 * @param array<string,mixed> $schema Schema catalog entry.
 * @param array<string,mixed> $entry  Treatment catalog entry.
 */
function nvx_aesthetic_schema_procedure_node(
	array $schema,
	array $entry,
	string $permalink,
	string $organization_id
): array {
	$node = array(
		'@type'             => array( 'MedicalProcedure', 'Service' ),
		'@id'               => $permalink . '#medical-procedure',
		'name'              => $schema['name'],
		'alternateName'     => $schema['alternateName'],
		'url'               => $permalink,
		'mainEntityOfPage'  => array( '@id' => $permalink ),
		'provider'          => array( '@id' => $organization_id ),
		'description'       => $entry['description'],
		'bodyLocation'      => $schema['bodyLocation'],
		'procedureType'     => $schema['procedureType'],
		'preparation'       => $schema['preparation'],
		'howPerformed'      => $schema['howPerformed'],
		'followup'          => $schema['followup'],
		'indication'        => nvx_aesthetic_schema_named_nodes( (array) $schema['indications'], 'MedicalIndication' ),
		'relevantCondition' => nvx_aesthetic_schema_named_nodes( (array) $schema['conditions'], 'MedicalCondition' ),
		'areaServed'        => array( 'Madrid', 'Chamberí', 'Barrio de Salamanca', 'Goya' ),
	);

	// Note: reviewedBy removed - belongs to WebPage only, not MedicalProcedure/Service
	// reviewedBy is now managed solely by nvx-medical-review.php for WebPage nodes
	// Note: performer property removed - belongs to Event, not MedicalProcedure/Service
	// MedicalProcedure uses provider relationship instead

	// Extract numeric price from price_range string for schema.org Offer.
	// Spanish tariffs use '.' as thousands separator and ',' as decimal
	// (e.g. "1.200,50 €"), so strip thousands dots before casting to float
	// to avoid publishing "1.200" as 1.2 in the schema.org Offer.
	if ( ! empty( $entry['price_range'] ) ) {
		$price_text = (string) $entry['price_range'];
		$numeric_price = null;
		$high_price = null;

		// Extract all numeric values from the price text
		if ( preg_match_all( '/(\d[\d.]*(?:,\d+)?)/', $price_text, $matches ) ) {
			$prices = array();
			foreach ( $matches[1] as $match ) {
				if ( false !== strpos( $match, ',' ) ) {
					$normalized = str_replace( '.', '', $match );
					$normalized = str_replace( ',', '.', $normalized );
				} else {
					$normalized = preg_replace( '/\.(?=\d{3}(?!\d))/', '', $match );
				}
				$prices[] = (float) $normalized;
			}

			if ( ! empty( $prices ) ) {
				$numeric_price = min( $prices );
				$high_price = max( $prices );
			}
		}

		if ( null !== $numeric_price && $numeric_price > 0 ) {
			$offer = array(
				'@type'         => 'Offer',
				'price'         => function_exists( 'nvx_schema_price_string' ) ? nvx_schema_price_string( $numeric_price ) : (string) $numeric_price,
				'priceCurrency' => 'EUR',
				'availability'  => 'https://schema.org/InStock',
				'description'   => $price_text,
			);

			if ( null !== $high_price && $high_price > $numeric_price ) {
				$offer['priceSpecification'] = array(
					'@type'         => 'PriceSpecification',
					'price'         => function_exists( 'nvx_schema_price_string' ) ? nvx_schema_price_string( $numeric_price ) : (string) $numeric_price,
					'priceCurrency' => 'EUR',
					'minPrice'      => function_exists( 'nvx_schema_price_string' ) ? nvx_schema_price_string( $numeric_price ) : (string) $numeric_price,
					'maxPrice'      => function_exists( 'nvx_schema_price_string' ) ? nvx_schema_price_string( $high_price ) : (string) $high_price,
				);
			} elseif ( false !== stripos( $price_text, 'desde' ) ) {
				$offer['priceSpecification'] = array(
					'@type'         => 'PriceSpecification',
					'price'         => function_exists( 'nvx_schema_price_string' ) ? nvx_schema_price_string( $numeric_price ) : (string) $numeric_price,
					'priceCurrency' => 'EUR',
					'minPrice'      => function_exists( 'nvx_schema_price_string' ) ? nvx_schema_price_string( $numeric_price ) : (string) $numeric_price,
				);
			}

			$node['offers'] = $offer;
		}
	}

	return $node;
}

/**
 * Point the matching WebPage node at the MedicalProcedure entity.
 *
 * @param array<int,array<string,mixed>> $graph Yoast graph.
 * @return array<int,array<string,mixed>>
 */
function nvx_aesthetic_schema_link_webpage_main_entity( array $graph, string $permalink, string $procedure_id ): array {
	foreach ( $graph as $index => $piece ) {
		$types = isset( $piece['@type'] ) ? (array) $piece['@type'] : array();
		if ( ! in_array( 'WebPage', $types, true ) || ! isset( $piece['url'] ) ) {
			continue;
		}
		if ( trailingslashit( $piece['url'] ) !== trailingslashit( $permalink ) ) {
			continue;
		}
		$graph[ $index ]['mainEntity'] = array( '@id' => $procedure_id );
		break;
	}
	return $graph;
}

/**
 * Add the governed MedicalProcedure/Service node to the Yoast graph.
 *
 * FAQPage ownership belongs to nvx-schema-faq.php.
 */
function nvx_aesthetic_treatment_extend_yoast_graph( $graph, $context = null ) {
	unset( $context );
	if ( ! is_array( $graph ) || ! function_exists( 'nvx_aesthetic_treatment_current_key' ) ) {
		return $graph;
	}

	$key = nvx_aesthetic_treatment_current_key();
	if ( null === $key ) {
		return $graph;
	}

	$entry =
		nvx_aesthetic_treatment_entry(
			$key
		);

	if (
		null === $entry
		|| empty( $entry['schema'] )
		|| ! is_array( $entry['schema'] )
	) {
		return $graph;
	}

	$schema =
		$entry['schema'];

	$permalink       = get_permalink( get_queried_object_id() );
	$organization    = function_exists( 'nvx_schema_find_organization' )
		? nvx_schema_find_organization( $graph )
		: array( 'id' => function_exists( 'nvx_schema_organization_id' ) ? nvx_schema_organization_id() : home_url( '/#organization' ) );
	$organization_id = ! empty( $organization['id'] ) ? $organization['id'] : ( function_exists( 'nvx_schema_organization_id' ) ? nvx_schema_organization_id() : home_url( '/#organization' ) );
	$procedure       =
		nvx_aesthetic_schema_procedure_node(
			$schema,
			$entry,
			$permalink,
			$organization_id
		);
	$graph           = nvx_aesthetic_schema_upsert_node( $graph, $procedure );

	$graph = nvx_aesthetic_schema_link_webpage_main_entity( $graph, $permalink, $procedure['@id'] );

	return array_values( $graph );
}
add_filter( 'wpseo_schema_graph', 'nvx_aesthetic_treatment_extend_yoast_graph', 55, 2 );
