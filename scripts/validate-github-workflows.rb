#!/usr/bin/env ruby
# frozen_string_literal: true

require 'find'
require 'open3'
require 'tmpdir'
require 'yaml'

ROOT = File.expand_path('..', __dir__)
GITHUB_DIR = File.join(ROOT, '.github')
FORBIDDEN_ACTION_REFS = %w[master main latest].freeze
FORBIDDEN_RUNTIME_FLAGS = %w[
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE20
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE22
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24
].freeze

# Production workflows must not pass by using placeholder credentials, dummy data,
# warning-only gates, skipped validations, or swallowed command failures.
FORBIDDEN_TEXT_PATTERNS = {
  /ci_dummy|dummy_|fake_|not-configured|your-project\.supabase\.co|your-anon-key|your-public-anon-key|your-publishable-key/i => 'placeholder or dummy credential/data detected',
  /continue-on-error:\s*true/i => 'continue-on-error is forbidden for production workflow gates',
  /skip_.*=true|skipped.*missing secrets|warning::.*skipped/i => 'skip-on-missing-secrets pattern detected',
  /\|\|\s*true/ => 'command failure swallowed with || true'
}.freeze

errors = []
workflow_files = Dir.glob(File.join(GITHUB_DIR, '**', '*.{yml,yaml}')).sort

if workflow_files.empty?
  errors << 'No GitHub YAML files found under .github/.'
end

def relative(path)
  path.delete_prefix(ROOT + '/')
end

def each_node(node, path = [], &block)
  yield(node, path)
  case node
  when Hash
    node.each { |key, value| each_node(value, path + [key], &block) }
  when Array
    node.each_with_index { |value, index| each_node(value, path + [index], &block) }
  end
end

def sanitize_github_expressions(script)
  script.gsub(/\$\{\{.*?\}\}/m, 'GITHUB_EXPRESSION')
end

def validate_bash_syntax(script, label, errors)
  sanitized = sanitize_github_expressions(script)
  Dir.mktmpdir('workflow-bash-') do |dir|
    path = File.join(dir, 'script.sh')
    File.write(path, "#!/usr/bin/env bash\n#{sanitized}\n")
    _stdout, stderr, status = Open3.capture3('bash', '-n', path)
    return if status.success?

    errors << "#{label}: bash syntax check failed: #{stderr.strip}"
  end
end

workflow_files.each do |file|
  rel = relative(file)
  text = File.read(file)

  if text.match?(/^(<<<<<<<|=======|>>>>>>>)$/)
    errors << "#{rel}: merge conflict marker detected"
  end

  FORBIDDEN_TEXT_PATTERNS.each do |pattern, message|
    next unless text.match?(pattern)

    errors << "#{rel}: #{message}"
  end

  FORBIDDEN_RUNTIME_FLAGS.each do |flag|
    errors << "#{rel}: remove deprecated global runtime flag #{flag}" if text.include?(flag)
  end

  begin
    parsed = YAML.safe_load(text, permitted_classes: [], permitted_symbols: [], aliases: true)
  rescue Psych::SyntaxError => e
    errors << "#{rel}: YAML syntax error at line #{e.line}, column #{e.column}: #{e.problem}"
    next
  end

  each_node(parsed) do |node, path|
    next unless node.is_a?(Hash)

    if node.key?('uses')
      action = node['uses'].to_s
      next if action.start_with?('./', 'docker://')

      unless action.include?('@')
        errors << "#{rel}: #{path.join('.')} uses '#{action}' without a pinned ref"
        next
      end

      ref = action.split('@', 2).last
      if FORBIDDEN_ACTION_REFS.include?(ref)
        errors << "#{rel}: #{path.join('.')} uses unstable action ref '#{action}'"
      end
    end

    next unless node.key?('run')

    shell = node['shell'].to_s
    next if shell.match?(/pwsh|powershell|cmd/i)

    label = "#{rel}: #{path.join('.')} run block"
    validate_bash_syntax(node['run'].to_s, label, errors)
  end
end

Find.find(ROOT) do |path|
  Find.prune if path == File.join(ROOT, '.git') || path == File.join(ROOT, 'node_modules') || path == File.join(ROOT, 'frontend', 'node_modules')
  next unless File.file?(path) && File.extname(path) == '.sh'

  _stdout, stderr, status = Open3.capture3('bash', '-n', path)
  next if status.success?

  errors << "#{relative(path)}: bash syntax check failed: #{stderr.strip}"
end

if errors.any?
  warn errors.map { |error| "::error::#{error}" }.join("\n")
  exit 1
end

puts "OK #{workflow_files.length} GitHub YAML files validated without placeholder/fake-data gates"
