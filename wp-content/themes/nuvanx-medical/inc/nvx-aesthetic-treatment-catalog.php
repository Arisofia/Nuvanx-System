<?php
/**
 * Canonical aesthetic-treatment catalog and route-resolution API.
 *
 * Contains no page rendering, hooks or CMS mutations.
 *
 * @package nuvanx-medical
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Required canonical fields.
 *
 * @return string[]
 */
if ( ! function_exists( 'nvx_aesthetic_catalog_required_keys' ) ) {
	function nvx_aesthetic_catalog_required_keys(): array {
		return array(
			'slug',
			'kicker',
			'h1',
			'lead',
			'description',
			'seo_title',
			'diagnosis',
			'indications',
			'precautions',
			'mechanism',
			'process',
			'evolution',
			'risks',
			'combinations',
			'faqs',
			'schema',
			'protocol',
			'brands',
			'duration',
			'session_time',
			'anesthesia',
			'techniques',
			'price_range',
			'sessions',
			'downtime',
		);
	}
}

/**
 * Log one bounded catalog anomaly.
 */
if ( ! function_exists( 'nvx_aesthetic_catalog_log' ) ) {
	function nvx_aesthetic_catalog_log(
		string $reason,
		string $record = ''
	): void {
		$reason = sanitize_key( $reason );
		$record = sanitize_key( $record );

		$message = sprintf(
			'Aesthetic catalog invalid: reason=%s record=%s.',
			'' !== $reason ? $reason : 'unknown',
			'' !== $record ? $record : 'none'
		);

		if ( function_exists( 'nvx_catalog_log_error' ) ) {
			nvx_catalog_log_error( $message );
			return;
		}

		error_log(
			sprintf(
				'NVX_AESTHETIC_CATALOG=INVALID reason=%s record=%s',
				'' !== $reason ? $reason : 'unknown',
				'' !== $record ? $record : 'none'
			)
		);
	}
}

/**
 * Normalize optional clinical values from nested protocol/schema sources.
 *
 * @param array<string,mixed> $entry Catalog entry.
 * @return array<string,mixed>
 */
if ( ! function_exists( 'nvx_aesthetic_catalog_normalize_entry' ) ) {
	function nvx_aesthetic_catalog_normalize_entry(
		array $entry
	): array {
		$sources = array(
			isset( $entry['protocol'] )
				&& is_array( $entry['protocol'] )
					? $entry['protocol']
					: array(),

			isset( $entry['schema'] )
				&& is_array( $entry['schema'] )
					? $entry['schema']
					: array(),
		);

		foreach ( $sources as $source ) {
			if (
				empty( $entry['price_range'] )
				&& ! empty( $source['price_range'] )
			) {
				$entry['price_range'] =
					$source['price_range'];
			}

			if (
				empty( $entry['session_time'] )
				&& ! empty( $source['session_time'] )
			) {
				$entry['session_time'] =
					$source['session_time'];
			}

			if ( empty( $entry['duration'] ) ) {
				if (
					! empty(
						$source['duration_result']
					)
				) {
					$entry['duration'] =
						$source['duration_result'];
				} elseif (
					! empty(
						$source['duration']
					)
				) {
					$entry['duration'] =
						$source['duration'];
				}
			}

			if (
				empty( $entry['anesthesia'] )
				&& ! empty( $source['anesthesia'] )
			) {
				$entry['anesthesia'] =
					$source['anesthesia'];
			}

			if ( empty( $entry['brands'] ) ) {
				if (
					! empty(
						$source['brands']
					)
				) {
					$entry['brands'] =
						(array) $source['brands'];
				} elseif (
					! empty(
						$source['products_used']
					)
				) {
					$entry['brands'] =
						(array)
							$source[
								'products_used'
							];
				}
			}

			if (
				empty( $entry['sessions'] )
				&& ! empty( $source['sessions'] )
			) {
				$entry['sessions'] =
					$source['sessions'];
			}

			if (
				empty( $entry['downtime'] )
				&& ! empty( $source['downtime'] )
			) {
				$entry['downtime'] =
					$source['downtime'];
			}
		}

		return $entry;
	}
}

/**
 * Validate one FAQ collection.
 *
 * @param mixed $faqs FAQ collection.
 */
if ( ! function_exists( 'nvx_aesthetic_catalog_valid_faqs' ) ) {
	function nvx_aesthetic_catalog_valid_faqs(
		mixed $faqs
	): bool {
		if ( ! is_array( $faqs ) ) {
			return false;
		}

		foreach ( $faqs as $faq ) {
			if (
				! is_array( $faq )
				|| ''
				=== trim(
					(string) (
						$faq['q']
						?? ''
					)
				)
				|| ''
				=== trim(
					(string) (
						$faq['a']
						?? ''
					)
				)
			) {
				return false;
			}
		}

		return true;
	}
}

/**
 * Canonical treatment catalogue.
 *
 * @return array<string,array<string,mixed>>
 */
if ( ! function_exists( 'nvx_aesthetic_treatment_catalog' ) ) {
	function nvx_aesthetic_treatment_catalog(): array {
		static $catalog = null;

		if ( is_array( $catalog ) ) {
			return $catalog;
		}

		$catalog = array();

		if (
			! function_exists(
				'nvx_catalog_json_resolved'
			)
			|| ! function_exists(
				'nvx_catalog_filter_records'
			)
		) {
			nvx_aesthetic_catalog_log(
				'dependency_missing'
			);

			return $catalog;
		}

		$raw =
			nvx_catalog_json_resolved(
				'aesthetic-treatment-pages.json'
			);

		if (
			! is_array( $raw )
			|| ! empty( $raw['_error'] )
		) {
			nvx_aesthetic_catalog_log(
				'catalog_unavailable'
			);

			return $catalog;
		}

		unset( $raw['_error'] );

		foreach (
			$raw
			as $key => $entry
		) {
			if ( is_array( $entry ) ) {
				$raw[ $key ] =
					nvx_aesthetic_catalog_normalize_entry(
						$entry
					);
			}
		}

		$raw =
			nvx_catalog_filter_records(
				$raw,
				nvx_aesthetic_catalog_required_keys(),
				'aesthetic-treatment-pages.json'
			);

		$seen_slugs = array();

		foreach (
			$raw
			as $raw_key => $entry
		) {
			if (
				! is_string( $raw_key )
				|| ! is_array( $entry )
			) {
				continue;
			}

			$key =
				sanitize_key(
					$raw_key
				);

			if (
				'' === $key
				|| $key !== $raw_key
			) {
				nvx_aesthetic_catalog_log(
					'invalid_key',
					$raw_key
				);

				continue;
			}

			$raw_slug =
				trim(
					(string) (
						$entry['slug']
						?? ''
					)
				);

			$slug =
				sanitize_title(
					$raw_slug
				);

			if (
				'' === $slug
				|| $slug !== $raw_slug
			) {
				nvx_aesthetic_catalog_log(
					'invalid_slug',
					$key
				);

				continue;
			}

			if (
				isset(
					$seen_slugs[
						$slug
					]
				)
			) {
				nvx_aesthetic_catalog_log(
					'duplicate_slug',
					$key
				);

				continue;
			}

			if (
				! is_array(
					$entry['schema']
				)
				|| ! is_array(
					$entry['protocol']
				)
				|| ! is_array(
					$entry['indications']
				)
				|| ! is_array(
					$entry['precautions']
				)
				|| ! is_array(
					$entry['process']
				)
				|| ! is_array(
					$entry['risks']
				)
				|| ! is_array(
					$entry['combinations']
				)
				|| ! nvx_aesthetic_catalog_valid_faqs(
					$entry['faqs']
				)
			) {
				nvx_aesthetic_catalog_log(
					'invalid_structured_fields',
					$key
				);

				continue;
			}

			$required_strings = array(
				'kicker',
				'h1',
				'lead',
				'description',
				'seo_title',
				'diagnosis',
				'mechanism',
				'evolution',
			);

			$valid_strings = true;

			foreach (
				$required_strings
				as $field
			) {
				if (
					''
					=== trim(
						(string) (
							$entry[
								$field
							]
							?? ''
						)
					)
				) {
					$valid_strings = false;
					break;
				}
			}

			if ( ! $valid_strings ) {
				nvx_aesthetic_catalog_log(
					'empty_required_field',
					$key
				);

				continue;
			}

			$entry['slug'] = $slug;

			$catalog[ $key ] =
				$entry;

			$seen_slugs[
				$slug
			] = $key;
		}

		return $catalog;
	}
}

/**
 * Resolve treatment key from canonical slug.
 */
if ( ! function_exists( 'nvx_aesthetic_treatment_key_from_slug' ) ) {
	function nvx_aesthetic_treatment_key_from_slug(
		string $slug
	): ?string {
		$slug =
			sanitize_title(
				trim(
					$slug,
					'/'
				)
			);

		if ( '' === $slug ) {
			return null;
		}

		foreach (
			nvx_aesthetic_treatment_catalog()
			as $key => $entry
		) {
			if (
				$slug
				=== (
					$entry['slug']
					?? ''
				)
			) {
				return (string) $key;
			}
		}

		return null;
	}
}

/**
 * Resolve treatment key from canonical path.
 */
if ( ! function_exists( 'nvx_aesthetic_treatment_key_from_path' ) ) {
	function nvx_aesthetic_treatment_key_from_path(
		string $path
	): ?string {
		$path =
			wp_parse_url(
				$path,
				PHP_URL_PATH
			);

		if ( ! is_string( $path ) ) {
			return null;
		}

		$slug =
			trim(
				$path,
				'/'
			);

		if (
			'' === $slug
			|| str_contains(
				$slug,
				'/'
			)
		) {
			return null;
		}

		return
			nvx_aesthetic_treatment_key_from_slug(
				$slug
			);
	}
}

/**
 * Whether legacy Staging seed recovery is allowed.
 */
if ( ! function_exists( 'nvx_aesthetic_legacy_seed_resolution_allowed' ) ) {
	function nvx_aesthetic_legacy_seed_resolution_allowed(): bool {
		return function_exists(
			'nvx_environment_is_staging2'
		)
			&& nvx_environment_is_staging2();
	}
}

/**
 * Resolve the current treatment key.
 */
if ( ! function_exists( 'nvx_aesthetic_treatment_current_key' ) ) {
	function nvx_aesthetic_treatment_current_key(): ?string {
		if (
			is_admin()
			|| ! is_singular( 'page' )
		) {
			return null;
		}

		$post_id =
			(int)
				get_queried_object_id();

		if ( $post_id <= 0 ) {
			return null;
		}

		/*
		 * Route is first authority.
		 */
		if (
			function_exists(
				'nvx_schema_current_path'
			)
		) {
			$path =
				nvx_schema_current_path(
					$post_id
				);

			if ( is_string( $path ) ) {
				$key =
					nvx_aesthetic_treatment_key_from_path(
						$path
					);

				if ( null !== $key ) {
					return $key;
				}
			}
		}

		/*
		 * Canonical CMS slug is second authority.
		 */
		$slug =
			(string)
				get_post_field(
					'post_name',
					$post_id
				);

		$key =
			nvx_aesthetic_treatment_key_from_slug(
				$slug
			);

		if ( null !== $key ) {
			return $key;
		}

		/*
		 * Historical seed recovery is staging-only.
		 */
		if (
			! nvx_aesthetic_legacy_seed_resolution_allowed()
		) {
			return null;
		}

		$catalog =
			nvx_aesthetic_treatment_catalog();

		$meta_key =
			get_post_meta(
				$post_id,
				'_nvx_aesthetic_treatment_key',
				true
			);

		if (
			is_string( $meta_key )
			&& isset(
				$catalog[
					$meta_key
				]
			)
		) {
			return $meta_key;
		}

		$content =
			(string)
				get_post_field(
					'post_content',
					$post_id
				);

		if (
			1 === preg_match(
				'/data-nvx-treatment=["\']([a-z0-9_-]+)["\']/i',
				$content,
				$matches
			)
		) {
			$marker_key =
				sanitize_key(
					(string)
						$matches[1]
				);

			if (
				isset(
					$catalog[
						$marker_key
					]
				)
			) {
				return $marker_key;
			}
		}

		return null;
	}
}

/**
 * Return one canonical treatment entry.
 *
 * @return array<string,mixed>|null
 */
if ( ! function_exists( 'nvx_aesthetic_treatment_entry' ) ) {
	function nvx_aesthetic_treatment_entry(
		string $key
	): ?array {
		$key =
			sanitize_key(
				$key
			);

		if ( '' === $key ) {
			return null;
		}

		$catalog =
			nvx_aesthetic_treatment_catalog();

		return isset(
			$catalog[
				$key
			]
		)
		&& is_array(
			$catalog[
				$key
			]
		)
			? $catalog[
				$key
			]
			: null;
	}
}

/**
 * Current page data.
 *
 * @return array<string,mixed>|null
 */
if ( ! function_exists( 'nvx_aesthetic_treatment_current' ) ) {
	function nvx_aesthetic_treatment_current(): ?array {
		$key =
			nvx_aesthetic_treatment_current_key();

		return null !== $key
			? nvx_aesthetic_treatment_entry(
				$key
			)
			: null;
	}
}

/**
 * Backward-compatible schema catalogue.
 *
 * @return array<string,array<string,mixed>>
 */
if ( ! function_exists( 'nvx_aesthetic_treatment_schema_catalog' ) ) {
	function nvx_aesthetic_treatment_schema_catalog(): array {
		$result = array();

		foreach (
			nvx_aesthetic_treatment_catalog()
			as $key => $entry
		) {
			if (
				isset( $entry['schema'] )
				&& is_array(
					$entry['schema']
				)
			) {
				$result[
					$key
				] = $entry['schema'];
			}
		}

		return $result;
	}
}
