Pod::Spec.new do |s|
  s.name           = 'NimboLive'
  s.version        = '0.1.0'
  s.summary        = 'Starts and updates the Nimbo Live Activity (Dynamic Island).'
  s.author         = 'Eduardo Maciel Wanka'
  s.homepage       = 'https://github.com/EduardoxDev/Nimbo'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.2' }
  s.source         = { git: 'https://github.com/EduardoxDev/Nimbo.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.swift'
  s.swift_version  = '5.9'
end
