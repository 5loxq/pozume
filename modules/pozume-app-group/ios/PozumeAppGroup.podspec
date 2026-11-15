require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name = 'PozumeAppGroup'
  s.version = package['version']
  s.summary = 'App Group storage for Pozume (Widget + Share Extension)'
  s.description = 'Schreibt die Server-Konfiguration in die App Group, damit Widget und Share-Extension darauf zugreifen können.'
  s.license = 'MIT'
  s.author = 'roman'
  s.homepage = 'https://poznote.com'
  s.source = { path: __dir__ }
  s.source_files = '**/*.swift'
  s.dependency 'ExpoModulesCore'
  s.swift_version = '5.0'
  s.platforms = { ios: '15.1' }
end
